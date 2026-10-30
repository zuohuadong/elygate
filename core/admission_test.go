package bifrost

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/stretchr/testify/require"
)

func admissionTestRefusal() *schemas.BifrostError {
	return &schemas.BifrostError{
		IsBifrostError: true,
		StatusCode:     schemas.Ptr(http.StatusServiceUnavailable),
		Error:          &schemas.ErrorField{Message: "policy installation is not ready"},
		AllowFallbacks: schemas.Ptr(true),
	}
}

type admissionTestPlugin struct {
	fakeRoutingPlugin
	calls atomic.Int64
}

func (p *admissionTestPlugin) PreRequestHook(*schemas.BifrostContext, *schemas.BifrostRequest) error {
	p.calls.Add(1)
	return nil
}

func (p *admissionTestPlugin) PreLLMHook(_ *schemas.BifrostContext, req *schemas.BifrostRequest) (*schemas.BifrostRequest, *schemas.LLMPluginShortCircuit, error) {
	p.calls.Add(1)
	return req, nil, nil
}

func (p *admissionTestPlugin) PostLLMHook(_ *schemas.BifrostContext, resp *schemas.BifrostResponse, _ *schemas.BifrostError) (*schemas.BifrostResponse, *schemas.BifrostError, error) {
	p.calls.Add(1)
	return resp, nil, nil
}

func newAdmissionTestClient(t *testing.T, admission schemas.RequestAdmission, plugins ...schemas.LLMPlugin) (*Bifrost, *atomic.Int64) {
	t.Helper()
	upstreamCalls := new(atomic.Int64)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upstreamCalls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"c1","object":"chat.completion","created":1,"model":"gpt-4","choices":[{"index":0,"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}]}`))
	}))
	t.Cleanup(upstream.Close)
	account := NewMockAccount()
	account.AddProviderWithBaseURL(schemas.OpenAI, 2, 8, upstream.URL)
	account.SetKeysForProvider(schemas.OpenAI, []schemas.Key{{
		ID: "admission-test", Name: "admission-test", Value: *schemas.NewSecretVar("test-key"),
		Models: schemas.WhiteList{"*"}, Weight: 1,
	}})
	client, err := Init(context.Background(), schemas.BifrostConfig{
		Account: account, Logger: NewDefaultLogger(schemas.LogLevelError),
		RequestAdmission: admission, LLMPlugins: plugins,
	})
	require.NoError(t, err)
	t.Cleanup(client.Shutdown)
	return client, upstreamCalls
}

func admissionTestChat() *schemas.BifrostChatRequest {
	return &schemas.BifrostChatRequest{
		Provider: schemas.OpenAI, Model: "gpt-4",
		Input:     []schemas.ChatMessage{{Role: schemas.ChatMessageRoleUser, Content: &schemas.ChatMessageContent{ContentStr: schemas.Ptr("hi")}}},
		Fallbacks: []schemas.Fallback{{Provider: schemas.OpenAI, Model: "fallback"}},
	}
}

// Boundaries: unary/stream, ordinary/internal/continuation, explicit/nil contexts,
// and a host returning a shared refusal. No plugin may recover this rejection.
func TestRequestAdmissionRejectsBeforePluginsAndProvider(t *testing.T) {
	refusal := admissionTestRefusal()
	plugin := &admissionTestPlugin{fakeRoutingPlugin: fakeRoutingPlugin{name: "recover-every-error"}}
	var admissionCalls atomic.Int64
	client, upstreamCalls := newAdmissionTestClient(t, func(ctx *schemas.BifrostContext, req *schemas.BifrostRequest) *schemas.BifrostError {
		admissionCalls.Add(1)
		require.NotNil(t, ctx)
		require.NotNil(t, req)
		return refusal
	}, plugin)
	for _, mode := range []string{"plain", "internal", "continuation", "nil"} {
		for _, streaming := range []bool{false, true} {
			t.Run(mode+map[bool]string{false: "/unary", true: "/stream"}[streaming], func(t *testing.T) {
				ctx := schemas.NewBifrostContext(context.Background(), schemas.NoDeadline)
				t.Cleanup(ctx.Cancel)
				switch mode {
				case "internal":
					PrepareContextForInternalRequest(ctx)
				case "continuation":
					ctx.SetValue(schemas.BifrostContextKeyMCPAgentServedRoute, &schemas.RoutingInfo{Provider: schemas.OpenAI, Model: "served"})
					require.NotNil(t, agentContinuationRoute(ctx))
				case "nil":
					ctx = nil
				}
				var got *schemas.BifrostError
				if streaming {
					stream, err := client.ChatCompletionStreamRequest(ctx, admissionTestChat())
					require.Nil(t, stream)
					got = err
				} else {
					response, err := client.ChatCompletionRequest(ctx, admissionTestChat())
					require.Nil(t, response)
					got = err
				}
				require.NotNil(t, got)
				require.NotSame(t, refusal, got)
				require.Equal(t, http.StatusServiceUnavailable, got.EffectiveHTTPStatus())
				require.Equal(t, false, *got.AllowFallbacks)
				require.Equal(t, schemas.OpenAI, got.ExtraFields.Provider)
				require.Equal(t, "gpt-4", got.ExtraFields.OriginalModelRequested)
				if streaming {
					require.Equal(t, schemas.ChatCompletionStreamRequest, got.ExtraFields.RequestType)
				} else {
					require.Equal(t, schemas.ChatCompletionRequest, got.ExtraFields.RequestType)
				}
			})
		}
	}
	require.Equal(t, int64(8), admissionCalls.Load())
	require.Zero(t, upstreamCalls.Load())
	require.Zero(t, plugin.calls.Load())
	require.True(t, *refusal.AllowFallbacks)
	require.Empty(t, refusal.ExtraFields.RequestType)
}

func TestRequestAdmissionCheckedHooksAndReload(t *testing.T) {
	refusal := admissionTestRefusal()
	plugin := &admissionTestPlugin{fakeRoutingPlugin: fakeRoutingPlugin{name: "observer"}}
	client, upstreamCalls := newAdmissionTestClient(t, func(*schemas.BifrostContext, *schemas.BifrostRequest) *schemas.BifrostError { return refusal }, plugin)
	ctx := schemas.NewBifrostContext(context.Background(), schemas.NoDeadline)
	defer ctx.Cancel()
	req := &schemas.BifrostRequest{RequestType: schemas.RealtimeRequest, ResponsesRequest: &schemas.BifrostResponsesRequest{Provider: schemas.OpenAI, Model: "voice"}}
	require.NotNil(t, client.RunPreRequestHooksChecked(ctx, req))
	require.Zero(t, plugin.calls.Load())
	require.NoError(t, client.ReloadConfig(schemas.BifrostConfig{}))
	require.NotNil(t, client.RunPreRequestHooksChecked(ctx, req), "unrelated config reload must not reopen admission")
	client.SetRequestAdmission(nil)
	require.Nil(t, client.RunPreRequestHooksChecked(ctx, req))
	require.Equal(t, int64(1), plugin.calls.Load())
	require.Zero(t, upstreamCalls.Load())
}

func TestRequestAdmissionAllowAndDisabledUseProvider(t *testing.T) {
	for _, admission := range []schemas.RequestAdmission{nil, func(*schemas.BifrostContext, *schemas.BifrostRequest) *schemas.BifrostError { return nil }} {
		client, upstreamCalls := newAdmissionTestClient(t, admission)
		resp, err := client.ChatCompletionRequest(nil, admissionTestChat())
		require.Nil(t, err)
		require.NotNil(t, resp)
		require.Equal(t, int64(1), upstreamCalls.Load())
	}
}

func TestRequestAdmissionDoesNotPinSharedNilContext(t *testing.T) {
	type testPolicyKey struct{}
	var closed atomic.Bool
	var seen []*schemas.BifrostContext
	client, upstreamCalls := newAdmissionTestClient(t, func(ctx *schemas.BifrostContext, req *schemas.BifrostRequest) *schemas.BifrostError {
		seen = append(seen, ctx)
		if ctx.Value(testPolicyKey{}) != nil {
			return nil
		}
		if closed.Load() {
			return admissionTestRefusal()
		}
		ctx.SetValue(testPolicyKey{}, "generation")
		return nil
	})
	for range 2 {
		response, err := client.ChatCompletionRequest(nil, admissionTestChat())
		require.Nil(t, err)
		require.NotNil(t, response)
	}
	require.NotSame(t, seen[0], seen[1])
	require.Nil(t, client.ctx.Value(testPolicyKey{}))
	closed.Store(true)
	response, err := client.ChatCompletionRequest(nil, admissionTestChat())
	require.Nil(t, response)
	require.NotNil(t, err)
	require.Equal(t, http.StatusServiceUnavailable, err.EffectiveHTTPStatus())
	require.Equal(t, int64(2), upstreamCalls.Load())
}

func TestRequestAdmissionConcurrentReplacementDoesNotMutateRefusal(t *testing.T) {
	refusal := admissionTestRefusal()
	client := &Bifrost{}
	admission := func(*schemas.BifrostContext, *schemas.BifrostRequest) *schemas.BifrostError { return refusal }
	client.SetRequestAdmission(admission)
	ctx := schemas.NewBifrostContext(context.Background(), schemas.NoDeadline)
	defer ctx.Cancel()
	var workers sync.WaitGroup
	for range 4 {
		workers.Go(func() {
			req := &schemas.BifrostRequest{RequestType: schemas.RealtimeRequest, ResponsesRequest: &schemas.BifrostResponsesRequest{Provider: schemas.OpenAI, Model: "voice"}}
			for range 100 {
				if got := client.AdmitRequest(ctx, req); got != nil && *got.AllowFallbacks {
					t.Error("admission refusal allowed fallbacks")
				}
			}
		})
	}
	for range 100 {
		client.SetRequestAdmission(nil)
		client.SetRequestAdmission(admission)
	}
	workers.Wait()
	require.True(t, *refusal.AllowFallbacks)
	require.Empty(t, refusal.ExtraFields.RequestType)
}

func TestRequestAdmissionStreamContextLivesUntilClosed(t *testing.T) {
	ctx := schemas.NewBifrostContext(context.Background(), schemas.NoDeadline)
	upstream := make(chan *schemas.BifrostStreamChunk)
	stream := cancelAdmissionContextAfterStream(ctx, upstream)
	require.NoError(t, ctx.Err())
	want := &schemas.BifrostStreamChunk{}
	go func() { upstream <- want; close(upstream) }()
	require.Same(t, want, <-stream)
	require.Eventually(t, func() bool { return ctx.Err() != nil }, time.Second, time.Millisecond)
	_, open := <-stream
	require.False(t, open)
}

func TestRequestAdmissionStreamDrainsOnCancellation(t *testing.T) {
	ctx := schemas.NewBifrostContext(context.Background(), schemas.NoDeadline)
	defer ctx.Cancel()
	upstream := make(chan *schemas.BifrostStreamChunk)
	stream := cancelAdmissionContextAfterStream(ctx, upstream)
	finished := make(chan struct{})
	go func() {
		defer close(finished)
		defer close(upstream)
		for range 3 {
			upstream <- &schemas.BifrostStreamChunk{}
		}
	}()
	ctx.Cancel()
	select {
	case <-finished:
	case <-time.After(time.Second):
		t.Fatal("cancelled relay did not drain the upstream")
	}
	_, open := <-stream
	require.False(t, open)
}

func TestRequestAdmissionNilSDKStreamRemainsActiveAfterReturn(t *testing.T) {
	release := make(chan struct{})
	var releaseOnce sync.Once
	t.Cleanup(func() { releaseOnce.Do(func() { close(release) }) })
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = fmt.Fprint(w, "data: {\"id\":\"test\",\"object\":\"chat.completion.chunk\",\"model\":\"gpt-4\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"prefix\"}}]}\n\n")
		w.(http.Flusher).Flush()
		select {
		case <-release:
		case <-r.Context().Done():
			return
		}
		_, _ = fmt.Fprint(w, "data: {\"id\":\"test\",\"object\":\"chat.completion.chunk\",\"model\":\"gpt-4\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hello\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
		w.(http.Flusher).Flush()
	}))
	t.Cleanup(upstream.Close)
	account := NewMockAccount()
	account.AddProviderWithBaseURL(schemas.OpenAI, 2, 8, upstream.URL)
	account.SetKeysForProvider(schemas.OpenAI, []schemas.Key{{
		ID: "stream-test", Value: *schemas.NewSecretVar("test-key"), Models: schemas.WhiteList{"*"}, Weight: 1,
	}})
	var admitted *schemas.BifrostContext
	client, err := Init(context.Background(), schemas.BifrostConfig{
		Account: account, InitialPoolSize: 1, Logger: NewDefaultLogger(schemas.LogLevelError),
		RequestAdmission: func(ctx *schemas.BifrostContext, _ *schemas.BifrostRequest) *schemas.BifrostError {
			admitted = ctx
			return nil
		},
	})
	require.NoError(t, err)
	t.Cleanup(client.Shutdown)
	stream, refusal := client.ChatCompletionStreamRequest(nil, admissionTestChat())
	require.Nil(t, refusal)
	require.NotNil(t, stream)
	require.NotNil(t, admitted)
	require.NotSame(t, client.ctx, admitted)
	require.NoError(t, admitted.Err(), "returning the channel must not cancel its request")
	releaseOnce.Do(func() { close(release) })
	content, errors := drainChatStream(stream)
	require.Empty(t, errors)
	require.Equal(t, "prefixhello", content)
	require.Eventually(t, func() bool { return admitted.Err() != nil }, time.Second, time.Millisecond)
}

func BenchmarkRequestAdmission(b *testing.B) {
	ctx := schemas.NewBifrostContext(context.Background(), schemas.NoDeadline)
	defer ctx.Cancel()
	req := &schemas.BifrostRequest{RequestType: schemas.RealtimeRequest}
	for _, testCase := range []struct {
		name      string
		admission schemas.RequestAdmission
	}{
		{"disabled", nil},
		{"allowed", func(*schemas.BifrostContext, *schemas.BifrostRequest) *schemas.BifrostError { return nil }},
	} {
		b.Run(testCase.name, func(b *testing.B) {
			client := &Bifrost{}
			client.SetRequestAdmission(testCase.admission)
			b.ReportAllocs()
			for b.Loop() {
				if client.AdmitRequest(ctx, req) != nil {
					b.Fatal("unexpected refusal")
				}
			}
		})
	}
}

// The legacy case is the unchanged entrypoint before admission was added.
// Comparing it with checked/disabled isolates the nil-gate cost on the same host.
func BenchmarkPreRequestAdmissionHooks(b *testing.B) {
	client, err := Init(context.Background(), schemas.BifrostConfig{
		Account: NewMockAccount(), InitialPoolSize: 1, Logger: NewDefaultLogger(schemas.LogLevelError),
	})
	require.NoError(b, err)
	defer client.Shutdown()
	ctx := schemas.NewBifrostContext(context.Background(), schemas.NoDeadline)
	defer ctx.Cancel()
	ctx.SetValue(schemas.BifrostContextKeyRequestID, "bench")
	req := &schemas.BifrostRequest{RequestType: schemas.RealtimeRequest}
	for _, entry := range []struct {
		name string
		run  func()
	}{
		{"legacy", func() { client.RunPreRequestHooks(ctx, req) }},
		{"checked-disabled", func() {
			if client.RunPreRequestHooksChecked(ctx, req) != nil {
				b.Fatal("unexpected refusal")
			}
		}},
	} {
		b.Run(entry.name, func(b *testing.B) {
			b.ReportAllocs()
			for b.Loop() {
				entry.run()
			}
		})
	}
}
