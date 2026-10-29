package controlplane

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"testing"

	"github.com/fasthttp/router"
	bifrost "github.com/maximhq/bifrost/core"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	configtables "github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/framework/encrypt"
	"github.com/maximhq/bifrost/framework/objectstore"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/handlers"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/lib"
	"github.com/stretchr/testify/require"
	"github.com/valyala/fasthttp"
	"gorm.io/gorm"
)

// Fail only the handler's reread, not any query inside the real store mutation.
type skillAuditReadStore struct {
	configstore.ConfigStore
	rereadFailure string
	writeErr      error
	committed     bool
	rereadCalls   int
}

func (s *skillAuditReadStore) GetSkill(ctx context.Context, id string) (*configtables.TableSkill, error) {
	if s.committed {
		s.rereadCalls++
		switch s.rereadFailure {
		case "error":
			return nil, errors.New("skill response reread unavailable")
		case "panic":
			panic("skill response reread panic")
		}
	}
	return s.ConfigStore.GetSkill(ctx, id)
}

func (s *skillAuditReadStore) UpdateSkill(ctx context.Context, skill *configtables.TableSkill, version string, serve bool, objects objectstore.ObjectStore) error {
	if s.writeErr != nil {
		return s.writeErr
	}
	err := s.ConfigStore.UpdateSkill(ctx, skill, version, serve, objects)
	s.committed = err == nil
	return err
}

func (s *skillAuditReadStore) ShiftSkillVersion(ctx context.Context, id, version string, objects objectstore.ObjectStore) error {
	if s.writeErr != nil {
		return s.writeErr
	}
	err := s.ConfigStore.ShiftSkillVersion(ctx, id, version, objects)
	s.committed = err == nil
	return err
}

type skillAuditMutation struct {
	name, method, path, body, action, serving string
}

func skillAuditMutations() []skillAuditMutation {
	const update = `{"description":"updated skill","skill_md_body":"private-updated-body","version":"1.2.0","metadata":{"token":"private-updated-metadata"},"extra_frontmatter":{"private_key":"private-extra-value"},"files":[{"path":"after.txt","source_type":"text","content":"private-updated-file","mime_type":"text/plain"}]}`
	return []skillAuditMutation{
		{"update-serving", "PUT", "/api/skills/audited-skill", update, "skill.updated", "1.2.0"},
		{"update-saved-only", "PUT", "/api/skills/audited-skill", update[:len(update)-1] + `,"serve":false}`, "skill.updated", "1.0.0"},
		{"shift", "POST", "/api/skills/audited-skill/shift-version", `{"version":"1.1.0"}`, "skill.version_shifted", "1.1.0"},
	}
}

func seedAuditedSkill(t *testing.T, cs configstore.ConfigStore) {
	t.Helper()
	ctx := context.Background()
	content := "private-original-file"
	skill := &configtables.TableSkill{
		ID: "audited-skill", Name: "audited-skill", Description: "original skill",
		SkillMDBody: "private-original-body",
		Metadata:    configtables.SkillStringMap{"token": "private-original-metadata"},
		Files: []configtables.TableSkillFile{{
			Path: "before.txt", SourceType: configtables.SkillSourceTypeText,
			InlineContent: &content, MimeType: "text/plain",
		}},
	}
	require.NoError(t, cs.CreateSkill(ctx, skill, "1.0.0", nil))
	skill.SkillMDBody = "private-saved-body"
	skill.Description = "saved skill"
	require.NoError(t, cs.UpdateSkill(ctx, skill, "1.1.0", false, nil))
}

func skillAuditSnapshot(t *testing.T, cs configstore.ConfigStore) string {
	t.Helper()
	ctx := context.Background()
	skill, err := cs.GetSkill(ctx, "audited-skill")
	require.NoError(t, err)
	var versions []configtables.TableSkillVersion
	require.NoError(t, cs.DB().Preload("Files").Order("version").Find(&versions, "skill_id = ?", skill.ID).Error)
	allVersion, err := cs.GetAllSkillsVersion(ctx)
	require.NoError(t, err)
	snapshot, err := json.Marshal(struct {
		Skill      *configtables.TableSkill
		Versions   []configtables.TableSkillVersion
		AllVersion string
	}{skill, versions, allVersion})
	require.NoError(t, err)
	return string(snapshot)
}

func skillAuditRequest(routes *router.Router, mutation skillAuditMutation, authorization string) *fasthttp.RequestCtx {
	var httpRequest fasthttp.Request
	request := &fasthttp.RequestCtx{}
	request.Init(&httpRequest, nil, nil)
	request.Request.Header.SetMethod(mutation.method)
	request.Request.SetRequestURI(mutation.path)
	request.Request.Header.SetContentType("application/json")
	request.Request.Header.Set("Authorization", authorization)
	request.Request.Header.Set("X-User-ID", "forged-skill-actor")
	request.Request.SetBodyString(mutation.body)
	routes.Handler(request)
	return request
}

func skillAuditRoutes(store *Store, cs configstore.ConfigStore, auth *handlers.AuthMiddleware) *router.Router {
	testLogger := bifrost.NewDefaultLogger(schemas.LogLevelError)
	audit := NewHandler(store, nil)
	routes := router.New()
	audit.RegisterRoutes(routes, auth.APIMiddleware())
	handlers.NewSkillsHandler(cs, nil).RegisterRoutes(routes,
		handlers.RecoveryMiddleware(handlers.NewCorsMiddleware(&lib.Config{})),
		auth.APIMiddleware(), audit.ManagementAuditMiddleware(testLogger))
	return routes
}

func failSkillAuditInsert(t *testing.T, cs configstore.ConfigStore) {
	t.Helper()
	require.NoError(t, cs.DB().Callback().Create().Before("gorm:create").Register("test:skill-audit", func(tx *gorm.DB) {
		if tx.Statement.Table == (AuditEvent{}).TableName() {
			tx.AddError(errors.New("skill audit unavailable"))
		}
	}))
	t.Cleanup(func() { cs.DB().Callback().Create().Remove("test:skill-audit") })
}

func requireSkillAuditSnapshots(t *testing.T, change configstore.AuditChange, serving string) {
	t.Helper()
	var before, after map[string]any
	require.NoError(t, json.Unmarshal(change.Before, &before))
	require.Equal(t, "1.0.0", before["latest_version"])
	require.Equal(t, float64(len("private-original-body")), before["skill_md_bytes"])
	require.Equal(t, []any{"token"}, before["metadata_keys"])
	require.NotContains(t, string(change.Before), "private-")
	if len(change.After) == 0 {
		return
	}
	require.NoError(t, json.Unmarshal(change.After, &after))
	require.Equal(t, serving, after["latest_version"])
	require.NotContains(t, string(change.After), "private-")
	// A normal successful reread must retain file references, not only identity.
	require.Len(t, after["files"], 1)
	if serving == "1.2.0" {
		files := after["files"].([]any)
		require.Equal(t, "after.txt", files[0].(map[string]any)["path"])
		require.Equal(t, []any{"private_key"}, after["extra_frontmatter_keys"])
	}
}

func TestManagementSkillAuditAfterPersistence(t *testing.T) {
	handlers.SetLogger(bifrost.NewDefaultLogger(schemas.LogLevelError))
	hash, err := encrypt.Hash("skill-audit-test-password")
	require.NoError(t, err)
	auth := &handlers.AuthMiddleware{}
	auth.UpdateAuthConfig(&configstore.AuthConfig{
		IsEnabled: true, AdminUserName: schemas.NewSecretVar("skill-admin"), AdminPassword: schemas.NewSecretVar(hash),
	})
	authorization := "Basic " + base64.StdEncoding.EncodeToString([]byte("skill-admin:skill-audit-test-password"))
	// Cases: serving/saved-only/shift; success, reread error/panic, rejected write, audit failure.
	for _, mutation := range skillAuditMutations() {
		t.Run(mutation.name, func(t *testing.T) {
			for _, outcome := range []string{"success", "reread-error", "reread-panic", "write-error", "audit-error", "audit-error-panic"} {
				t.Run(outcome, func(t *testing.T) {
					store, cs := testControlPlaneStore(t)
					seedAuditedSkill(t, cs)
					before := skillAuditSnapshot(t, cs)
					wrapped := &skillAuditReadStore{ConfigStore: cs}
					if outcome == "write-error" {
						wrapped.writeErr = errors.New("skill mutation rejected before write")
					}
					if outcome == "reread-error" || outcome == "audit-error" {
						wrapped.rereadFailure = "error"
					}
					if outcome == "reread-panic" || outcome == "audit-error-panic" {
						wrapped.rereadFailure = "panic"
					}
					if outcome == "audit-error" || outcome == "audit-error-panic" {
						failSkillAuditInsert(t, cs)
					}
					routes := skillAuditRoutes(store, wrapped, auth)
					require.Equal(t, 401, skillAuditRequest(routes, mutation, "").Response.StatusCode())
					response := skillAuditRequest(routes, mutation, authorization)
					wantStatus := 500
					if outcome == "success" {
						wantStatus = 200
					}
					require.Equal(t, wantStatus, response.Response.StatusCode(), "%s", response.Response.Body())
					after := skillAuditSnapshot(t, cs)
					if outcome == "write-error" {
						require.Equal(t, before, after)
						require.Zero(t, wrapped.rereadCalls)
					} else {
						require.NotEqual(t, before, after)
						require.Equal(t, 1, wrapped.rereadCalls)
						skill, err := cs.GetSkill(context.Background(), "audited-skill")
						require.NoError(t, err)
						require.Equal(t, mutation.serving, skill.LatestVersion)
					}
					assertManagementSkillAudit(t, routes, response, struct {
						mutation      skillAuditMutation
						outcome, auth string
					}{mutation, outcome, authorization})
				})
			}
		})
	}
}

func assertManagementSkillAudit(t *testing.T, routes *router.Router, response *fasthttp.RequestCtx, expected struct {
	mutation      skillAuditMutation
	outcome, auth string
}) {
	t.Helper()
	feedRequest := skillAuditMutation{method: "GET", path: "/api/control-plane/audit-events"}
	require.Equal(t, 401, skillAuditRequest(routes, feedRequest, "").Response.StatusCode())
	feed := skillAuditRequest(routes, feedRequest, expected.auth)
	require.Equal(t, 200, feed.Response.StatusCode(), "%s", feed.Response.Body())
	var payload struct {
		Data []AuditEvent `json:"data"`
	}
	require.NoError(t, json.Unmarshal(feed.Response.Body(), &payload))
	changes, _ := response.UserValue(configstore.AuditChangesUserValueKey).([]configstore.AuditChange)
	if expected.outcome == "write-error" {
		require.Empty(t, payload.Data)
		require.Empty(t, changes)
		return
	}
	require.Len(t, changes, 1)
	require.Equal(t, expected.mutation.action, changes[0].EventName)
	require.Equal(t, "audited-skill", changes[0].TargetID)
	requireSkillAuditSnapshots(t, changes[0], expected.mutation.serving)
	if expected.outcome != "success" {
		require.Nil(t, changes[0].After, "unavailable after-state must not be invented")
	} else {
		require.NotEmpty(t, changes[0].After)
	}
	if expected.outcome == "audit-error" || expected.outcome == "audit-error-panic" {
		require.Empty(t, payload.Data)
		require.Equal(t, "failed", string(response.Response.Header.Peek(lib.HeaderAuditStatus)))
	} else {
		require.Len(t, payload.Data, 1)
		require.Equal(t, expected.mutation.action, payload.Data[0].Action)
		require.Equal(t, "skill", payload.Data[0].ResourceType)
		require.Equal(t, "audited-skill", payload.Data[0].ResourceID)
		require.Equal(t, "local-admin:skill-admin", payload.Data[0].ActorID)
		require.Empty(t, response.Response.Header.Peek(lib.HeaderAuditStatus))
	}
	for _, forbidden := range []string{"private-", "skill-audit-test-password", "forged-skill-actor", "reread", "metadata", "skill_md"} {
		require.NotContains(t, string(feed.Response.Body()), forbidden)
	}
}
