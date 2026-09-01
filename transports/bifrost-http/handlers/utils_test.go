package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	bifrost "github.com/maximhq/bifrost/core"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/valyala/fasthttp"
)

// TestIsUniqueConstraintError recognizes common database unique-constraint messages.
func TestIsUniqueConstraintError(t *testing.T) {
	cases := []string{
		"UNIQUE constraint failed: enterprise_access_profiles.name",
		`pq: duplicate key value violates unique constraint "idx_access_profiles_name"`,
		"Error 1062: Duplicate entry 'profile-a' for key 'enterprise_access_profiles.name'",
	}
	for _, tc := range cases {
		if !IsUniqueConstraintError(errors.New(tc)) {
			t.Fatalf("IsUniqueConstraintError(%q)=false, want true", tc)
		}
	}
	if IsUniqueConstraintError(errors.New("connection refused")) {
		t.Fatalf("non-unique error should not match")
	}
}

// TestIsUniqueConstraintError_Identifiers narrows matches to requested fields or indexes.
func TestIsUniqueConstraintError_Identifiers(t *testing.T) {
	err := errors.New(`pq: duplicate key value violates unique constraint "idx_access_profiles_name"`)
	if !IsUniqueConstraintError(err, "idx_access_profiles_name") {
		t.Fatalf("identifier match returned false")
	}
	if IsUniqueConstraintError(err, "enterprise_users.email") {
		t.Fatalf("unrelated identifier matched")
	}
}

// TestSendJSON_StandardBytes pins the exact json.NewEncoder byte contract that the
// switch to sonic must not regress: HTML escaping, sorted map keys (deterministic
// output), and a trailing newline. The input has out-of-order keys and HTML
// metacharacters so all three properties show up in one exact-bytes comparison.
// sonic.ConfigDefault would break every one of them.
func TestSendJSON_StandardBytes(t *testing.T) {
	ctx := &fasthttp.RequestCtx{}
	SendJSON(ctx, map[string]string{"z": "1", "a": "<b>&</b>"})

	got := string(ctx.Response.Body())
	want := `{"a":"\u003cb\u003e\u0026\u003c/b\u003e","z":"1"}` + "\n"
	if got != want {
		t.Errorf("SendJSON bytes mismatch:\n got  %q\n want %q", got, want)
	}
}

// TestSendJSON_Deterministic pins that a many-key map serializes byte-identically
// every time. Without key sorting (ConfigDefault) Go's randomized map iteration
// would make this flaky — the regression we must never reintroduce.
func TestSendJSON_Deterministic(t *testing.T) {
	m := map[string]int{"a": 1, "b": 2, "c": 3, "d": 4, "e": 5, "f": 6, "g": 7, "h": 8}
	first := &fasthttp.RequestCtx{}
	SendJSON(first, m)
	want := string(first.Response.Body())
	for i := 0; i < 50; i++ {
		ctx := &fasthttp.RequestCtx{}
		SendJSON(ctx, m)
		if got := string(ctx.Response.Body()); got != want {
			t.Fatalf("non-deterministic output on iter %d:\n want %s\n got  %s", i, want, got)
		}
	}
}

// TestSendJSONWithStatus_StandardBytes mirrors SendJSON's exact-bytes contract and
// pins the custom status code.
func TestSendJSONWithStatus_StandardBytes(t *testing.T) {
	ctx := &fasthttp.RequestCtx{}
	SendJSONWithStatus(ctx, map[string]string{"z": "1", "a": "<x>"}, fasthttp.StatusCreated)

	if got := ctx.Response.StatusCode(); got != fasthttp.StatusCreated {
		t.Errorf("status = %d, want %d", got, fasthttp.StatusCreated)
	}
	got := string(ctx.Response.Body())
	want := `{"a":"\u003cx\u003e","z":"1"}` + "\n"
	if got != want {
		t.Errorf("SendJSONWithStatus bytes mismatch:\n got  %q\n want %q", got, want)
	}
}

// TestSendJSON_MarshalError pins the marshal-failure early-return: an unsupported
// value (a channel) must yield HTTP 500 and the SendError body, never a partial or
// panicking write. Guards the err != nil branch that the happy-path tests skip.
func TestSendJSON_MarshalError(t *testing.T) {
	SetLogger(&mockLogger{}) // error path logs a warning; shared no-op logger
	ctx := &fasthttp.RequestCtx{}
	SendJSON(ctx, make(chan int)) // channels are unmarshalable

	if got := ctx.Response.StatusCode(); got != fasthttp.StatusInternalServerError {
		t.Errorf("status = %d, want %d", got, fasthttp.StatusInternalServerError)
	}
	if body := string(ctx.Response.Body()); !strings.Contains(body, "Failed to encode response") {
		t.Errorf("expected SendError body, got %q", body)
	}
}

func TestSendBifrostErrorIncludesDerivedStatusCode(t *testing.T) {
	ctx := &fasthttp.RequestCtx{}
	SendBifrostError(ctx, &schemas.BifrostError{
		IsBifrostError: true,
		Error:          &schemas.ErrorField{Message: bifrost.ProviderAutoResolveErrorMessage},
	})

	if got := ctx.Response.StatusCode(); got != fasthttp.StatusBadRequest {
		t.Fatalf("status = %d, want %d", got, fasthttp.StatusBadRequest)
	}
	var payload struct {
		StatusCode *int `json:"status_code"`
	}
	if err := json.Unmarshal(ctx.Response.Body(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.StatusCode == nil || *payload.StatusCode != fasthttp.StatusBadRequest {
		t.Fatalf("status_code = %v, want %d", payload.StatusCode, fasthttp.StatusBadRequest)
	}
}

func TestCheckURLAccessibility_FileExists(t *testing.T) {
	f, err := os.CreateTemp(t.TempDir(), "pricing-*.json")
	if err != nil {
		t.Fatal(err)
	}
	f.Close()

	if err := checkURLAccessibility("file://" + f.Name()); err != nil {
		t.Fatalf("expected no error for existing file, got: %v", err)
	}
}

func TestCheckURLAccessibility_FileMissing(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nonexistent.json")
	if err := checkURLAccessibility("file://" + path); err == nil {
		t.Fatal("expected error for missing file, got nil")
	}
}

func TestCheckURLAccessibility_HTTP200(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	if err := checkURLAccessibility(srv.URL); err != nil {
		t.Fatalf("expected no error for HTTP 200, got: %v", err)
	}
}

func TestCheckURLAccessibility_HTTPNon200(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	if err := checkURLAccessibility(srv.URL); err == nil {
		t.Fatal("expected error for HTTP 404, got nil")
	}
}

// TestSendJSONWithStatus_MarshalError mirrors the marshal-failure early-return for
// the custom-status helper: the 500 from SendError must win over the requested
// status code.
func TestSendJSONWithStatus_MarshalError(t *testing.T) {
	SetLogger(&mockLogger{})
	ctx := &fasthttp.RequestCtx{}
	SendJSONWithStatus(ctx, make(chan int), fasthttp.StatusCreated)

	if got := ctx.Response.StatusCode(); got != fasthttp.StatusInternalServerError {
		t.Errorf("status = %d, want %d (SendError must override the requested status)", got, fasthttp.StatusInternalServerError)
	}
	if body := string(ctx.Response.Body()); !strings.Contains(body, "Failed to encode response") {
		t.Errorf("expected SendError body, got %q", body)
	}
}
