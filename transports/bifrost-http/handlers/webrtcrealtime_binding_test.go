package handlers

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	bifrost "github.com/maximhq/bifrost/core"
	openaiProvider "github.com/maximhq/bifrost/core/providers/openai"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/controlplane"
	bfws "github.com/maximhq/bifrost/transports/v2/bifrost-http/websocket"
	"github.com/pion/webrtc/v4"
	"github.com/stretchr/testify/require"
)

type webRTCApplicationKeyFixture struct {
	store       *controlplane.Store
	configStore configstore.ConfigStore
	key         *controlplane.ApplicationKey
}

func newWebRTCApplicationKeyFixture(t *testing.T) webRTCApplicationKeyFixture {
	t.Helper()
	ctx := context.Background()
	cs, err := configstore.NewConfigStore(ctx, &configstore.Config{
		Enabled: true, Type: configstore.ConfigStoreTypeSQLite,
		Config: &configstore.SQLiteConfig{Path: filepath.Join(t.TempDir(), "webrtc-binding.db")},
	}, bifrost.NewDefaultLogger(schemas.LogLevelError))
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, cs.Close(ctx)) })
	store, err := controlplane.NewStoreWithBindingMode(ctx, cs, controlplane.ApplicationBindingRequired)
	require.NoError(t, err)
	project := &controlplane.Project{Name: "Realtime"}
	require.NoError(t, store.CreateProject(ctx, project))
	app := &controlplane.Application{ProjectID: project.ID, Name: "Voice"}
	require.NoError(t, store.CreateApplication(ctx, app))
	expiresAt := time.Now().UTC().Add(time.Hour)
	key, err := store.CreateApplicationKey(ctx, app.ID, "session", "", &expiresAt, "admin")
	require.NoError(t, err)
	return webRTCApplicationKeyFixture{store: store, configStore: cs, key: key}
}

func (fixture webRTCApplicationKeyFixture) invalidate(t *testing.T, mutation string) {
	t.Helper()
	ctx := context.Background()
	switch mutation {
	case "revoke key":
		require.NoError(t, fixture.store.RevokeApplicationKey(ctx, fixture.key.ApplicationID, fixture.key.VirtualKeyID, "admin"))
	case "revoke binding":
		require.NoError(t, fixture.store.RevokeBinding(ctx, fixture.key.ApplicationID))
	case "expire binding":
		// Move the stored deadline across the clock without a timing-dependent sleep.
		require.NoError(t, fixture.configStore.DB().Model(&controlplane.ApplicationVirtualKeyBinding{}).
			Where("id = ?", fixture.key.BindingID).Update("expires_at", time.Now().UTC().Add(-time.Minute)).Error)
	case "rotate key":
		rotated, err := fixture.store.RotateApplicationKey(ctx, fixture.key.ApplicationID, fixture.key.VirtualKeyID, "admin")
		require.NoError(t, err)
		require.Equal(t, fixture.key.VirtualKeyID, rotated.VirtualKeyID)
		require.NoError(t, fixture.store.CheckVirtualKeyValueAccess(ctx, rotated.Value))
	default:
		t.Fatalf("unknown key mutation %q", mutation)
	}
	require.Error(t, fixture.store.CheckVirtualKeyValueAccess(ctx, fixture.key.Value))
}

func TestWebRTCRealtimeSessionRejectsChangedApplicationKey(t *testing.T) {
	for _, turn := range webRTCAccessTurnCases() {
		for _, mutation := range []string{"revoke key", "revoke binding", "expire binding", "rotate key"} {
			t.Run(turn.name+"/"+mutation, func(t *testing.T) {
				fixture := newWebRTCApplicationKeyFixture(t)
				messages := newWebRTCTurnAccessMessages(t, controlplane.NewHandler(fixture.store, nil), fixture.key.Value)
				messages.transcriptionSession = turn.name == "transcription"
				relay := &webrtcRelay{handler: messages}
				start := webrtc.DataChannelMessage{Data: []byte(turn.event), IsString: true}
				turn.deliver(messages, relay, start)
				require.NotNil(t, messages.session.PeekRealtimeTurnHooks())
				complete := `{"type":"response.done","response":{"id":"response","status":"completed"}}`
				if messages.transcriptionSession {
					complete = `{"type":"conversation.item.input_audio_transcription.completed","item_id":"audio","transcript":"hello"}`
				}
				messages.fromProvider(relay, webrtc.DataChannelMessage{Data: []byte(complete), IsString: true})
				require.Nil(t, messages.session.PeekRealtimeTurnHooks())
				require.False(t, relay.closing)
				relay.pendingToUpstream, relay.pendingToDownstream = nil, nil
				fixture.invalidate(t, mutation)
				turn.deliver(messages, relay, start)
				require.True(t, relay.closing)
				require.Nil(t, messages.session.PeekRealtimeTurnHooks())
				require.Empty(t, relay.pendingToUpstream, "a refused browser response.create must not reach the provider")
				require.Empty(t, relay.pendingToDownstream, "a refused provider turn event must not reach the browser")
			})
		}
	}
}

func TestWebRTCRealtimeRelayRejectsRevokedKeyOverDataChannel(t *testing.T) {
	fixture := newWebRTCApplicationKeyFixture(t)
	gateway := newLiveOwnerTestGateway(t, nil)
	handler := NewWebRTCRealtimeHandler(gateway.client, gateway.config)
	handler.SetVirtualKeyAccessChecker(controlplane.NewHandler(fixture.store, nil))
	t.Cleanup(handler.Close)
	rtProvider := &openaiProvider.OpenAIProvider{}
	browser := newWebRTCTestPeer(t)
	_, err := browser.pc.AddTransceiverFromKind(webrtc.RTPCodecTypeAudio)
	require.NoError(t, err)
	browserDC, err := browser.pc.CreateDataChannel(rtProvider.RealtimeWebRTCDataChannelLabel(), nil)
	require.NoError(t, err)
	browser.bind(browserDC)
	offer, err := browser.pc.CreateOffer(nil)
	require.NoError(t, err)
	browserOffer := gatheredSDP(t, browser.pc, offer)
	upstream := newWebRTCTestPeer(t)
	upstream.pc.OnDataChannel(upstream.bind)
	requestCtx := liveCallerCtx(t, "")
	requestCtx.SetValue(schemas.BifrostContextKeyVirtualKey, fixture.key.Value)
	relayCtx, cancel := newRealtimeRelayContext(requestCtx)
	t.Cleanup(cancel)
	session := bfws.NewSession(nil)
	t.Cleanup(session.Close)
	answer, bifrostErr := handler.establishRelay(
		relayCtx, cancel, session, rtProvider, schemas.OpenAI, "gpt-realtime-mini", nil, browserOffer, false,
		func(_ *schemas.BifrostContext, upstreamOffer string) (string, *schemas.BifrostError) {
			require.NoError(t, upstream.pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeOffer, SDP: upstreamOffer}))
			providerAnswer, answerErr := upstream.pc.CreateAnswer(nil)
			require.NoError(t, answerErr)
			return gatheredSDP(t, upstream.pc, providerAnswer), nil
		})
	require.Nil(t, bifrostErr)
	require.NoError(t, browser.pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: answer}))
	browser.waitOpen(t)
	upstream.waitOpen(t)
	browser.send(t, `{"type":"response.create"}`)
	require.Contains(t, upstream.next(t), `"type":"response.create"`)
	upstream.send(t, `{"type":"response.done","response":{"id":"first","status":"completed"}}`)
	require.Contains(t, browser.next(t), `"type":"response.done"`)
	fixture.invalidate(t, "revoke key")
	browser.send(t, `{"type":"response.create"}`)
	refusal, err := schemas.ParseRealtimeEvent([]byte(browser.next(t)))
	require.NoError(t, err)
	require.Equal(t, schemas.RTEventError, refusal.Type)
	require.NotNil(t, refusal.Error)
	require.Equal(t, "authentication_error", refusal.Error.Type)
	require.Equal(t, "virtual key access is no longer active", refusal.Error.Message)
	require.Eventually(t, func() bool {
		handler.mu.Lock()
		defer handler.mu.Unlock()
		return len(handler.relays) == 0
	}, 5*time.Second, 5*time.Millisecond)
	select {
	case unexpected := <-upstream.messages:
		t.Fatalf("refused request reached upstream: %s", unexpected)
	default:
	}
}
