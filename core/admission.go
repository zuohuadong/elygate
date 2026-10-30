package bifrost

import "github.com/maximhq/bifrost/core/schemas"

// SetRequestAdmission replaces the host's admission callback atomically.
// It is separate from ReloadConfig so unrelated config reloads cannot reopen
// a closed host gate by supplying a config with a nil callback.
func (bifrost *Bifrost) SetRequestAdmission(admission schemas.RequestAdmission) {
	if admission == nil {
		bifrost.requestAdmission.Store(nil)
		return
	}
	bifrost.requestAdmission.Store(&admission)
}

// AdmitRequest checks only host admission, not authorization or routing.
// Direct-provider transports must call it (or RunPreRequestHooksChecked) and
// return any refusal before opening upstream. It does not govern MCP/A2A tools
// or subsequent frames of an already-open provider session.
func (bifrost *Bifrost) AdmitRequest(ctx *schemas.BifrostContext, req *schemas.BifrostRequest) *schemas.BifrostError {
	admission := bifrost.requestAdmission.Load()
	if admission == nil {
		return nil
	}
	if ctx == nil || ctx == bifrost.ctx {
		ctx = schemas.NewBifrostContext(bifrost.ctx, schemas.NoDeadline)
		defer ctx.Cancel()
	}
	return runRequestAdmission(admission, ctx, req)
}

func runRequestAdmission(admission *schemas.RequestAdmission, ctx *schemas.BifrostContext, req *schemas.BifrostRequest) *schemas.BifrostError {
	if admission == nil {
		return nil
	}
	refusal := (*admission)(ctx, req)
	if refusal == nil {
		return nil
	}
	// The host may reuse an immutable refusal across goroutines. Stamp our own
	// copy rather than racing on its metadata or changing its fallback policy.
	stamped := *refusal
	stamped.AllowFallbacks = schemas.Ptr(false)
	if req != nil {
		provider, model, _ := req.GetRequestFields()
		stamped.PopulateExtraFields(req.RequestType, provider, model, model)
	}
	return &stamped
}

// Only nil-context callers with host admission need this relay. An accepted
// stream owns its private context until its last chunk, not merely until the
// method returns. Drain on cancellation so producers can release state even
// when the caller has stopped reading.
func cancelAdmissionContextAfterStream(ctx *schemas.BifrostContext, upstream chan *schemas.BifrostStreamChunk) chan *schemas.BifrostStreamChunk {
	if upstream == nil {
		ctx.Cancel()
		return nil
	}
	stream := make(chan *schemas.BifrostStreamChunk, cap(upstream))
	go func() {
		defer ctx.Cancel()
		defer close(stream)
		for chunk := range upstream {
			select {
			case stream <- chunk:
			case <-ctx.Done():
				for range upstream {
				}
				return
			}
		}
	}()
	return stream
}
