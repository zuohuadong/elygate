package controlplane

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	bifrost "github.com/maximhq/bifrost/core"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

type routingCrashCommand struct {
	Config    *configstore.Config `json:"config"`
	Epoch     int64               `json:"epoch"`
	Phase     string              `json:"phase"`
	ReadyPath string              `json:"ready_path"`
}

func openRoutingCrashStore(t *testing.T, config *configstore.Config) (*Store, configstore.ConfigStore) {
	t.Helper()
	cs, err := configstore.NewConfigStore(t.Context(), config, bifrost.NewDefaultLogger(schemas.LogLevelError))
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, cs.Close(context.Background())) })
	require.Equal(t, string(config.Type), cs.DB().Dialector.Name())
	store, err := NewStore(t.Context(), cs)
	require.NoError(t, err)
	return store, cs
}

func TestRoutingInstallationProcessCrash(t *testing.T) {
	// Both operations are killed after all transactional writes, on either
	// side of SQL commit, without letting deferred cleanup run in the child.
	for _, operation := range []RoutingReleaseOperation{RoutingReleasePublish, RoutingReleaseRollback} {
		for _, phase := range []string{"before-commit", "after-commit"} {
			t.Run(string(operation)+"/"+phase, func(t *testing.T) {
				config := &configstore.Config{Enabled: true, Type: configstore.ConfigStoreTypeSQLite,
					Config: &configstore.SQLiteConfig{Path: filepath.Join(t.TempDir(), "crash.db")}}
				if socket := os.Getenv("ELYGATE_TEST_POSTGRES_SOCKET"); socket != "" {
					config = testPostgresControlPlaneConfig(t, socket)
				}
				store, cs := openRoutingCrashStore(t, config)
				require.NoError(t, cs.UpdateClientConfig(t.Context(), &configstore.ClientConfig{RoutingChainMaxDepth: 9}))
				request := routingCrashRequest(t, store, operation)
				attempt, err := store.AcceptRoutingRelease(t.Context(), request)
				require.NoError(t, err)
				beforeFingerprint := routingLiveFingerprint(t, cs)
				beforeApplications := routingApplications(t, store)
				beforeAudits := routingReleaseAudits(t, store)
				require.NoError(t, cs.Close(context.Background()))

				killRoutingInstaller(t, routingCrashCommand{Config: config, Epoch: attempt.Epoch, Phase: phase})

				reopened, restored := openRoutingCrashStore(t, config)
				t.Logf("routing process crash backend: %s, phase: %s", restored.DB().Dialector.Name(), phase)
				assertRoutingCrashState(t, reopened, phase, beforeFingerprint)
				applications := routingApplications(t, reopened)
				audits := routingReleaseAudits(t, reopened)
				if phase == "before-commit" {
					require.Equal(t, beforeApplications, applications)
					require.Equal(t, beforeAudits, audits)
				} else {
					require.Len(t, applications, len(beforeApplications)+1)
					require.Equal(t, beforeApplications, applications[:len(applications)-1])
					require.Equal(t, attempt.ID, applications[len(applications)-1].AttemptID)
					require.Len(t, audits, len(beforeAudits)+1)
					require.Equal(t, beforeAudits, audits[:len(audits)-1])
					require.Equal(t, "routing-release.apply", audits[len(audits)-1].Action)
					require.Equal(t, attempt.ID, audits[len(audits)-1].ResourceID)
				}
				replayed, err := reopened.AcceptRoutingRelease(t.Context(), request)
				require.NoError(t, err)
				require.Equal(t, *attempt, *replayed)
				installation, err := reopened.InstallAcceptedRoutingRelease(t.Context(), attempt.Epoch, rollbackTestCompiler, "explicit-recovery")
				require.NoError(t, err)
				require.True(t, installation.Head.IsApplied())
				require.Len(t, routingApplications(t, reopened), len(beforeApplications)+1)
				require.Len(t, routingReleaseAudits(t, reopened), len(beforeAudits)+1)
				state, err := CheckRoutingPolicyStartup(t.Context(), restored, rollbackTestCompiler)
				require.NoError(t, err)
				require.True(t, state.Managed)
				require.NotNil(t, state.Policy)
				require.Equal(t, installation.Policy, *state.Policy)
			})
		}
	}
}

func routingCrashRequest(t *testing.T, store *Store, operation RoutingReleaseOperation) RoutingReleaseRequest {
	t.Helper()
	first := appliedRollbackFixture(t, store, "original", 2)
	if operation == RoutingReleaseRollback {
		current := appliedRollbackFixture(t, store, "replacement", 4)
		return rollbackRequest(first, current)
	}
	version := routingReleaseVersion(t, store)
	return RoutingReleaseRequest{
		VersionID: version.ID, ExpectedEpoch: first.Epoch, IdempotencyKey: uuid.NewString(), ActorID: "crash-admin",
	}
}

func assertRoutingCrashState(t *testing.T, store *Store, phase, previousFingerprint string) {
	t.Helper()
	state, err := CheckRoutingPolicyStartup(t.Context(), store.configStore, rollbackTestCompiler)
	head, headErr := store.GetRoutingReleaseHead(t.Context())
	require.NoError(t, headErr)
	if phase == "before-commit" {
		require.ErrorIs(t, err, ErrRoutingPolicyNotReady)
		require.Nil(t, state.Policy, "pending crash recovery must not supply a serving policy")
		require.False(t, head.IsApplied())
		require.Equal(t, previousFingerprint, routingLiveFingerprint(t, store.configStore))
		return
	}
	require.NoError(t, err)
	require.True(t, head.IsApplied())
	require.True(t, state.Managed)
	require.NotNil(t, state.Policy)
	require.NotEqual(t, previousFingerprint, routingLiveFingerprint(t, store.configStore))
}

func killRoutingInstaller(t *testing.T, installerCommand routingCrashCommand) {
	t.Helper()
	installerCommand.ReadyPath = filepath.Join(t.TempDir(), "ready")
	payload, err := json.Marshal(installerCommand)
	require.NoError(t, err)
	executable, err := os.Executable()
	require.NoError(t, err)
	ctx, cancel := context.WithTimeout(t.Context(), 90*time.Second)
	defer cancel()
	child := exec.CommandContext(ctx, executable, "-test.run=^TestRoutingInstallationCrashChild$", "-test.count=1")
	child.Env = append(os.Environ(), "ELYGATE_ROUTING_CRASH_CHILD=1")
	child.Stdin = strings.NewReader(string(payload))
	logPath := filepath.Join(t.TempDir(), "child.log")
	log, err := os.Create(logPath)
	require.NoError(t, err)
	defer func() { require.NoError(t, log.Close()) }()
	child.Stdout, child.Stderr = log, log
	require.NoError(t, child.Start())
	exited := make(chan struct{})
	var waitErr error
	go func() {
		waitErr = child.Wait()
		close(exited)
	}()
	t.Cleanup(func() {
		cancel()
		<-exited
	})
	awaitRoutingCrashCheckpoint(t, installerCommand, exited, logPath)
	require.NoError(t, child.Process.Kill())
	<-exited
	var exitError *exec.ExitError
	require.ErrorAs(t, waitErr, &exitError, "the installer must not exit normally or run cleanup")
	require.Equal(t, -1, exitError.ExitCode(), "the installer must terminate from the external kill")
	require.NoError(t, ctx.Err(), "a test deadline must not count as the intended crash")
}

func awaitRoutingCrashCheckpoint(t *testing.T, installerCommand routingCrashCommand, exited <-chan struct{}, logPath string) {
	t.Helper()
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	timeout := time.NewTimer(90 * time.Second)
	defer timeout.Stop()
	for {
		select {
		case <-exited:
			childLog, readErr := os.ReadFile(logPath)
			require.NoError(t, readErr)
			t.Fatalf("installer exited before crash checkpoint:\n%s", childLog)
		case <-timeout.C:
			t.Fatal("installer never reached crash checkpoint within 90 seconds")
		case <-ticker.C:
			_, err := os.Stat(installerCommand.ReadyPath)
			if err == nil {
				return
			}
			require.True(t, errors.Is(err, os.ErrNotExist), "cannot inspect crash checkpoint: %v", err)
		}
	}
}

func TestRoutingInstallationCrashChild(t *testing.T) {
	if os.Getenv("ELYGATE_ROUTING_CRASH_CHILD") != "1" {
		return
	}
	var installerCommand routingCrashCommand
	require.NoError(t, json.NewDecoder(os.Stdin).Decode(&installerCommand))
	require.Contains(t, []string{"before-commit", "after-commit"}, installerCommand.Phase)
	store, cs := openRoutingCrashStore(t, installerCommand.Config)
	pause := func() error {
		if err := os.WriteFile(installerCommand.ReadyPath, []byte(installerCommand.Phase), 0600); err != nil {
			return err
		}
		time.Sleep(2 * time.Minute)
		return errors.New("parent did not kill the installer at its checkpoint")
	}
	if installerCommand.Phase == "before-commit" {
		require.NoError(t, cs.DB().Callback().Create().After("gorm:create").Register("test:routing-crash", func(tx *gorm.DB) {
			if tx.Statement.Table == (AuditEvent{}).TableName() {
				require.NoError(t, tx.Error, "all installation writes must succeed before the pre-commit crash")
				tx.AddError(pause())
			}
		}))
	} else {
		db, err := cs.DB().DB()
		require.NoError(t, err)
		store = routingInstallationWithPool(t, store, &routingInstallationFaultPool{
			DB: db, commitWrites: true, afterCommit: pause,
		})
	}
	_, err := store.InstallAcceptedRoutingRelease(t.Context(), installerCommand.Epoch, rollbackTestCompiler, "crash-installer")
	t.Fatalf("installation returned instead of being killed: %v", err)
}
