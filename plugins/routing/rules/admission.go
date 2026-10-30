package rules

import "github.com/maximhq/bifrost/core/schemas"

// Admit is idempotent for requests pinned to this store, including internal
// sub-requests and subsequent turns of an already-admitted realtime session.
func (rs *LocalStore) Admit(ctx *schemas.BifrostContext, req *schemas.BifrostRequest) bool {
	if ctx == nil {
		return false
	}
	if rs.pinnedGeneration(ctx) != nil {
		return true
	}
	rs.writer.Lock()
	defer rs.writer.Unlock()
	if !rs.admissionOpen {
		return false
	}
	if req != nil && (req.RequestType == schemas.RealtimeRequest || req.RequestType == schemas.LiveRequest) {
		ctx.SetValueForRealtimeTurns(routingGenerationContextKey{}, rs.current.Load())
	} else {
		ctx.SetValue(routingGenerationContextKey{}, rs.current.Load())
	}
	return true
}

func (rs *LocalStore) CloseAdmission() bool {
	rs.writer.Lock()
	wasOpen := rs.admissionOpen
	rs.admissionOpen = false
	rs.writer.Unlock()
	return wasOpen
}

func (rs *LocalStore) OpenAdmission() {
	rs.writer.Lock()
	rs.admissionOpen = true
	rs.writer.Unlock()
}

// ManagePolicy permanently disables individual rule/depth mutations. Only a
// complete prepared policy may replace a managed generation.
func (rs *LocalStore) ManagePolicy() {
	rs.writer.Lock()
	rs.policyManaged = true
	rs.writer.Unlock()
}

func (rs *LocalStore) CheckPolicyWritable() error {
	rs.writer.Lock()
	defer rs.writer.Unlock()
	return rs.policyWriteError()
}

func (rs *LocalStore) policyWriteError() error {
	if !rs.admissionOpen {
		return ErrPolicyAdmissionClosed
	}
	if rs.policyManaged {
		return ErrPolicyManaged
	}
	return nil
}

func (rs *LocalStore) pinnedGeneration(ctx *schemas.BifrostContext) *ruleGeneration {
	generation, _ := ctx.Value(routingGenerationContextKey{}).(*ruleGeneration)
	if generation != nil && generation.owner == rs {
		return generation
	}
	return nil
}

// SnapshotForRequest keeps the admission generation if installation happened
// while earlier plugins or a complexity sub-request were running.
func (rs *LocalStore) SnapshotForRequest(ctx *schemas.BifrostContext) ReadStore {
	if ctx != nil {
		if generation := rs.pinnedGeneration(ctx); generation != nil {
			return generation
		}
	}
	return rs.current.Load()
}
