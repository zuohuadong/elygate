package handlers

import (
	"context"
	"errors"
	"strconv"
	"sync/atomic"
	"testing"

	"github.com/fasthttp/router"
	openaiProvider "github.com/maximhq/bifrost/core/providers/openai"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/kvstore"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/lib"
	bfws "github.com/maximhq/bifrost/transports/v2/bifrost-http/websocket"
	"github.com/pion/webrtc/v4"
	"github.com/stretchr/testify/require"
	"github.com/valyala/fasthttp"
)

func TestWebRTCRelayChecksResolvedVirtualKeyBeforeSelectingKey(t *testing.T) {
	gateway := newLiveOwnerTestGateway(t, nil)
	kv, err := kvstore.New(kvstore.Config{})
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, kv.Close()) })
	require.NoError(t, kv.Set(buildRealtimeEphemeralKeyMappingKey("ek_mapped"), realtimeEphemeralKeyMapping{
		VirtualKey: "sk-bf-mapped", KeyID: "key-1", ProviderToken: "ek_provider",
	}))

	// Include mapped tokens, direct keys, and transport-only provider tokens.
	cases := []struct {
		name       string
		header     string
		credential string
		resolved   string
		denied     bool
		noChecker  bool
		hookKey    string
	}{
		{name: "unbound", header: "x-bf-vk", credential: "sk-bf-unbound", resolved: "sk-bf-unbound", denied: true},
		{name: "revoked", header: "Authorization", credential: "Bearer sk-bf-revoked", resolved: "sk-bf-revoked", denied: true},
		{name: "mapped revoked", header: "Authorization", credential: "Bearer ek_mapped", resolved: "sk-bf-mapped", denied: true},
		{name: "active", header: "x-bf-vk", credential: "sk-bf-active", resolved: "sk-bf-active"},
		{name: "provider ephemeral", header: "Authorization", credential: "Bearer ek_external"},
		{name: "no credential"},
		{name: "no checker", header: "x-bf-vk", credential: "sk-bf-active", noChecker: true},
		{name: "hook cannot rewrite credential", header: "x-bf-vk", credential: "sk-bf-original", hookKey: "sk-bf-hook", resolved: "sk-bf-original", denied: true},
		{name: "hook cannot rewrite mapping", header: "Authorization", credential: "Bearer ek_mapped", hookKey: "sk-bf-hook", resolved: "sk-bf-mapped", denied: true},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			handler := NewWebRTCRealtimeHandler(gateway.client, gateway.config)
			handler.handlerStore = testHandlerStore{kv: kv}
			t.Cleanup(handler.Close)
			var seen []string
			var denied error
			if test.denied {
				denied = errors.New("private storage error")
			}
			var checkedAfterHook bool
			probe := webRTCBindingPolicyProbe{
				recordingVirtualKeyChecker: recordingVirtualKeyChecker{seen: &seen, errV: denied},
				replacementKey:             test.hookKey,
				checkedAfterHook:           &checkedAfterHook,
			}
			require.NoError(t, gateway.client.ReloadPlugin(probe, []schemas.PluginType{schemas.PluginTypeLLM}))
			if !test.noChecker {
				handler.SetVirtualKeyAccessChecker(probe)
			}
			var request fasthttp.RequestCtx
			request.Request.SetRequestURI("/openai/v1/realtime/calls")
			if test.header != "" {
				request.Request.Header.Set(test.header, test.credential)
			}
			var exchanged atomic.Bool
			handler.runWebRTCRelay(&request, &openaiProvider.OpenAIProvider{}, schemas.OpenAI, "gpt-live-1", "invalid SDP", nil, false,
				func(*schemas.BifrostContext, schemas.Key, string, []byte) (string, *schemas.BifrostError) {
					exchanged.Store(true)
					return "", nil
				})
			if test.resolved != "" {
				require.Equal(t, []string{":value:" + test.resolved}, seen)
				if !test.noChecker {
					require.True(t, checkedAfterHook, "access checks must follow the pre-request pipeline")
				}
			} else {
				require.Empty(t, seen)
			}
			if test.denied {
				require.Equal(t, fasthttp.StatusUnauthorized, request.Response.StatusCode())
				require.Contains(t, string(request.Response.Body()), "virtual key access is no longer active")
				require.NotContains(t, string(request.Response.Body()), "private storage error")
				resolvedCtx := request.UserValue(lib.FastHTTPUserValueBifrostContext).(*schemas.BifrostContext)
				require.Nil(t, resolvedCtx.Value(schemas.BifrostContextKeySelectedKeyID))
			} else {
				require.Equal(t, fasthttp.StatusBadRequest, request.Response.StatusCode(), "invalid SDP must be reached after admission")
			}
			require.False(t, exchanged.Load(), "no SDP may be sent upstream for a rejected key or malformed offer")
		})
	}
}

const webRTCBindingHookContextKey = "webrtc-binding-policy-prehook-ran"

type webRTCBindingPolicyProbe struct {
	recordingVirtualKeyChecker
	replacementKey   string
	checkedAfterHook *bool
}

var _ schemas.LLMPlugin = webRTCBindingPolicyProbe{}

func (webRTCBindingPolicyProbe) GetName() string { return "webrtc-binding-policy" }
func (webRTCBindingPolicyProbe) Cleanup() error  { return nil }
func (probe webRTCBindingPolicyProbe) PreRequestHook(ctx *schemas.BifrostContext, _ *schemas.BifrostRequest) error {
	ctx.SetValue(webRTCBindingHookContextKey, true)
	// The upstream pipeline must keep this reserved credential immutable.
	if probe.replacementKey != "" {
		ctx.SetValue(schemas.BifrostContextKeyVirtualKey, probe.replacementKey)
	}
	return nil
}
func (webRTCBindingPolicyProbe) PreLLMHook(_ *schemas.BifrostContext, request *schemas.BifrostRequest) (*schemas.BifrostRequest, *schemas.LLMPluginShortCircuit, error) {
	return request, nil, nil
}
func (webRTCBindingPolicyProbe) PostLLMHook(_ *schemas.BifrostContext, response *schemas.BifrostResponse, bifrostErr *schemas.BifrostError) (*schemas.BifrostResponse, *schemas.BifrostError, error) {
	return response, bifrostErr, nil
}
func (probe webRTCBindingPolicyProbe) CheckVirtualKeyValueAccess(ctx context.Context, keyValue string) error {
	*probe.checkedAfterHook, _ = ctx.Value(webRTCBindingHookContextKey).(bool)
	return probe.recordingVirtualKeyChecker.CheckVirtualKeyValueAccess(ctx, keyValue)
}

func TestWebRTCRoutesRejectInactiveVirtualKey(t *testing.T) {
	gateway := newLiveOwnerTestGateway(t, nil)
	handler := NewWebRTCRealtimeHandler(gateway.client, gateway.config)
	handler.handlerStore = testHandlerStore{}
	t.Cleanup(handler.Close)
	var seen []string
	handler.SetVirtualKeyAccessChecker(recordingVirtualKeyChecker{seen: &seen, errV: errors.New("revoked")})
	routes := router.New()
	handler.RegisterRoutes(routes)
	for _, route := range []string{
		"/v1/realtime/calls?model=openai/gpt-live-1",
		"/v1/realtime?model=openai/gpt-live-1",
		"/openai/v1/realtime/calls?model=gpt-live-1",
		"/openai/v1/realtime?model=gpt-live-1",
	} {
		t.Run(route, func(t *testing.T) {
			seen = nil
			var request fasthttp.RequestCtx
			request.Request.Header.SetMethod(fasthttp.MethodPost)
			request.Request.SetRequestURI(route)
			request.Request.Header.SetContentType("application/sdp")
			request.Request.Header.Set("x-bf-vk", "sk-bf-revoked")
			request.Request.SetBodyString("invalid SDP")
			routes.Handler(&request)
			require.Equal(t, []string{":value:sk-bf-revoked"}, seen)
			require.Equal(t, fasthttp.StatusUnauthorized, request.Response.StatusCode())
		})
	}
}

func TestWebRTCRealtimeSessionRevalidatesVirtualKeyBeforeNewTurn(t *testing.T) {
	for _, turn := range webRTCAccessTurnCases() {
		for _, denial := range []error{nil, errors.New("private storage failure")} {
			t.Run(turn.name+"/"+strconv.FormatBool(denial != nil), func(t *testing.T) {
				var seen []string
				messages := newWebRTCTurnAccessMessages(t, recordingVirtualKeyChecker{seen: &seen, errV: denial}, "sk-bf-session")
				probe := &webRTCTurnHookProbe{}
				require.NoError(t, messages.client.ReloadPlugin(probe, []schemas.PluginType{schemas.PluginTypeLLM}))
				messages.transcriptionSession = turn.name == "transcription"
				relay := &webrtcRelay{handler: messages}
				turn.deliver(messages, relay, webrtc.DataChannelMessage{Data: []byte(turn.event), IsString: true})
				require.Equal(t, []string{":value:sk-bf-session"}, seen)
				if denial != nil {
					require.Zero(t, probe.calls.Load(), "refusal must precede the turn pipeline, not just clear its state afterward")
					require.True(t, relay.closing)
					require.Nil(t, messages.session.PeekRealtimeTurnHooks())
					require.Empty(t, relay.pendingToUpstream)
					require.Empty(t, relay.pendingToDownstream)
				} else {
					require.EqualValues(t, 1, probe.calls.Load())
					require.False(t, relay.closing)
					require.NotNil(t, messages.session.PeekRealtimeTurnHooks())
					require.Equal(t, 1, len(relay.pendingToUpstream)+len(relay.pendingToDownstream))
				}
			})
		}
	}
}

type webRTCTurnHookProbe struct{ calls atomic.Int64 }

var _ schemas.LLMPlugin = (*webRTCTurnHookProbe)(nil)

func (*webRTCTurnHookProbe) GetName() string { return "webrtc-turn-access-hook-probe" }
func (*webRTCTurnHookProbe) Cleanup() error  { return nil }
func (*webRTCTurnHookProbe) PreRequestHook(*schemas.BifrostContext, *schemas.BifrostRequest) error {
	return nil
}
func (probe *webRTCTurnHookProbe) PreLLMHook(_ *schemas.BifrostContext, request *schemas.BifrostRequest) (*schemas.BifrostRequest, *schemas.LLMPluginShortCircuit, error) {
	probe.calls.Add(1)
	return request, nil, nil
}
func (*webRTCTurnHookProbe) PostLLMHook(_ *schemas.BifrostContext, response *schemas.BifrostResponse, bifrostErr *schemas.BifrostError) (*schemas.BifrostResponse, *schemas.BifrostError, error) {
	return response, bifrostErr, nil
}

type webRTCAccessTurnCase struct {
	name    string
	event   string
	deliver func(*realtimeWebRTCMessages, *webrtcRelay, webrtc.DataChannelMessage)
}

func webRTCAccessTurnCases() []webRTCAccessTurnCase {
	return []webRTCAccessTurnCase{
		{"browser", `{"type":"response.create"}`, (*realtimeWebRTCMessages).fromBrowser},
		{"automatic", `{"type":"response.created","response":{"id":"response"}}`, (*realtimeWebRTCMessages).fromProvider},
		{"transcription", `{"type":"input_audio_buffer.committed","item_id":"audio"}`, (*realtimeWebRTCMessages).fromProvider},
	}
}

func newWebRTCTurnAccessMessages(t *testing.T, checker VirtualKeyAccessChecker, virtualKey string) *realtimeWebRTCMessages {
	t.Helper()
	gateway := newLiveOwnerTestGateway(t, nil)
	session := bfws.NewSession(nil)
	t.Cleanup(session.Close)
	ctx := liveCallerCtx(t, "")
	ctx.SetValue(schemas.BifrostContextKeyVirtualKey, virtualKey)
	return &realtimeWebRTCMessages{
		client: gateway.client, session: session, bifrostCtx: ctx,
		accessChecker: checker, provider: &openaiProvider.OpenAIProvider{},
		providerKey: schemas.OpenAI, model: "gpt-realtime-mini",
	}
}

func TestWebRTCRealtimeTurnAccessDoesNotRecheckAcknowledgmentsOrChunks(t *testing.T) {
	var seen []string
	messages := newWebRTCTurnAccessMessages(t, recordingVirtualKeyChecker{seen: &seen}, "sk-bf-session")
	relay := &webrtcRelay{handler: messages}
	messages.fromBrowser(relay, webrtc.DataChannelMessage{Data: []byte(`{"type":"response.create"}`), IsString: true})
	require.Len(t, seen, 1)
	messages.accessChecker = recordingVirtualKeyChecker{seen: &seen, errV: errors.New("revoked")}
	for _, event := range []string{
		`{"type":"response.created","response":{"id":"response"}}`,
		`{"type":"response.output_text.delta","delta":"hello"}`,
	} {
		messages.fromProvider(relay, webrtc.DataChannelMessage{Data: []byte(event), IsString: true})
	}
	messages.fromBrowser(relay, webrtc.DataChannelMessage{Data: []byte(`{"type":"input_audio_buffer.append","audio":"AA=="}`), IsString: true})
	require.Len(t, seen, 1)
	require.False(t, relay.closing)
	require.NotNil(t, messages.session.PeekRealtimeTurnHooks())
	messages.fromProvider(relay, webrtc.DataChannelMessage{Data: []byte(`{"type":"response.done","response":{"id":"response","status":"completed"}}`), IsString: true})
	require.Nil(t, messages.session.PeekRealtimeTurnHooks())
	messages.fromBrowser(relay, webrtc.DataChannelMessage{Data: []byte(`{"type":"response.create"}`), IsString: true})
	require.Len(t, seen, 2)
	require.True(t, relay.closing)
	require.Len(t, relay.pendingToUpstream, 2, "only the first response.create and audio chunk may reach the provider")
}

func TestWebRTCRealtimeTurnAccessErrorBoundary(t *testing.T) {
	var seen []string
	messages := newWebRTCTurnAccessMessages(t, recordingVirtualKeyChecker{seen: &seen, errV: errors.New("private storage failure")}, "sk-bf-session")
	denial := messages.checkVirtualKeyAccess()
	require.NotNil(t, denial)
	require.Equal(t, 401, *denial.StatusCode)
	wire := string(newRealtimeTurnErrorEventPayload(denial))
	require.Contains(t, wire, `"type":"authentication_error"`)
	require.Contains(t, wire, "virtual key access is no longer active")
	require.NotContains(t, wire, "private storage failure")
	require.NotContains(t, wire, "sk-bf-session")
}

func TestWebRTCRealtimeTurnAccessPreservesActiveTranscriptionAndIdleChunks(t *testing.T) {
	var seen []string
	messages := newWebRTCTurnAccessMessages(t, recordingVirtualKeyChecker{seen: &seen}, "sk-bf-session")
	messages.transcriptionSession = true
	relay := &webrtcRelay{handler: messages}
	commit := webrtc.DataChannelMessage{Data: []byte(`{"type":"input_audio_buffer.committed","item_id":"audio"}`), IsString: true}
	messages.fromProvider(relay, commit)
	started := messages.session.PeekRealtimeTurnHooks()
	require.NotNil(t, started)
	require.Len(t, seen, 1)
	messages.accessChecker = recordingVirtualKeyChecker{seen: &seen, errV: errors.New("revoked")}
	messages.fromProvider(relay, commit)
	require.Len(t, seen, 1)
	require.Same(t, started, messages.session.PeekRealtimeTurnHooks())
	require.Len(t, relay.pendingToDownstream, 2)
	messages.session.ClearRealtimeTurnHooks()
	messages.fromProvider(relay, webrtc.DataChannelMessage{Data: []byte(`{"type":"response.output_audio.delta","delta":"AA=="}`), IsString: true})
	require.Len(t, seen, 1, "an audio chunk must not trigger a storage read even without active hooks")
	require.Nil(t, messages.session.PeekRealtimeTurnHooks())
	require.False(t, relay.closing)
}

func TestWebRTCRealtimeTurnAccessWithoutVirtualKeyOrChecker(t *testing.T) {
	for _, test := range []struct {
		name       string
		virtualKey string
		checker    bool
	}{
		{"provider-native or anonymous", "", true},
		{"unconfigured checker", "sk-bf-session", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			var seen []string
			var checker VirtualKeyAccessChecker
			if test.checker {
				checker = recordingVirtualKeyChecker{seen: &seen, errV: errors.New("denied")}
			}
			messages := newWebRTCTurnAccessMessages(t, checker, test.virtualKey)
			relay := &webrtcRelay{handler: messages}
			messages.fromBrowser(relay, webrtc.DataChannelMessage{Data: []byte(`{"type":"response.create"}`), IsString: true})
			require.Empty(t, seen)
			require.False(t, relay.closing)
			require.Len(t, relay.pendingToUpstream, 1)
		})
	}
}
