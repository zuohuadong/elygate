package routing

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sync"
	"sync/atomic"
	"time"

	"github.com/maximhq/bifrost/core/schemas"
	configstoreTables "github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/plugins/routing/rules"
)

const shadowSampleBasis = uint64(10000)

// ShadowReport is the bounded, request-metadata-only result of comparing a
// candidate policy with the live decision. It intentionally carries no body,
// headers or credentials so reporters can persist it without retaining
// stream-sized request data.
type ShadowReport struct {
	Timestamp    time.Time
	RequestType  string
	Provider     schemas.ModelProvider
	Model        string
	VirtualKeyID string
	Live         *rules.Decision
	Candidate    *rules.Decision
	CandidateErr string
	Match        bool
}

// ShadowReporter receives comparisons from a worker goroutine. It must return
// promptly; a slow reporter consumes the bounded shadow queue.
type ShadowReporter func(ShadowReport)

type shadowSample struct {
	ctx  *rules.EvaluationContext
	live *rules.Decision
}

// ShadowEvaluator asynchronously evaluates a candidate policy against sampled
// request contexts. Submission is non-blocking: a full queue drops the sample
// and never delays or changes the serving request.
type ShadowEvaluator struct {
	engine   *rules.Engine
	reporter ShadowReporter
	logger   schemas.Logger
	queue    chan shadowSample
	done     chan struct{}
	wg       sync.WaitGroup
	closed   atomic.Bool
	sequence atomic.Uint64
	rate     uint64
}

// NewShadowEvaluator constructs a bounded evaluator. sampleRate must be in
// [0,1], and queueSize must be positive.
func NewShadowEvaluator(
	store rules.Store,
	governance rules.GovernanceStore,
	logger schemas.Logger,
	chainMaxDepth int,
	sampleRate float64,
	queueSize int,
	reporter ShadowReporter,
) (*ShadowEvaluator, error) {
	if store == nil || governance == nil || logger == nil || reporter == nil {
		return nil, errors.New("shadow evaluator requires store, governance, logger and reporter")
	}
	if chainMaxDepth <= 0 {
		return nil, errors.New("shadow evaluator chain max depth must be positive")
	}
	if math.IsNaN(sampleRate) || math.IsInf(sampleRate, 0) || sampleRate < 0 || sampleRate > 1 {
		return nil, fmt.Errorf("shadow evaluator sample rate must be between 0 and 1")
	}
	if queueSize <= 0 {
		return nil, errors.New("shadow evaluator queue size must be positive")
	}
	engine, err := rules.NewEngine(store, governance, logger, &chainMaxDepth)
	if err != nil {
		return nil, err
	}
	rate := uint64(math.Round(sampleRate * float64(shadowSampleBasis)))
	if sampleRate > 0 && rate == 0 {
		rate = 1
	}
	evaluator := &ShadowEvaluator{
		engine:   engine,
		reporter: reporter,
		logger:   logger,
		queue:    make(chan shadowSample, queueSize),
		done:     make(chan struct{}),
		rate:     rate,
	}
	evaluator.wg.Add(1)
	go evaluator.run()
	return evaluator, nil
}

func (e *ShadowEvaluator) run() {
	defer e.wg.Done()
	for {
		select {
		case sample := <-e.queue:
			e.evaluate(sample)
		case <-e.done:
			for {
				select {
				case sample := <-e.queue:
					e.evaluate(sample)
				default:
					return
				}
			}
		}
	}
}

func (e *ShadowEvaluator) evaluate(sample shadowSample) {
	shadowCtx := schemas.NewBifrostContext(context.Background(), time.Now())
	candidate, err := e.engine.EvaluateRoutingRules(shadowCtx, sample.ctx)
	report := ShadowReport{
		Timestamp:    time.Now().UTC(),
		RequestType:  sample.ctx.RequestType,
		Provider:     sample.ctx.Provider,
		Model:        sample.ctx.Model,
		VirtualKeyID: sample.ctx.Scope.VirtualKeyID,
		Live:         cloneDecision(sample.live),
		Candidate:    cloneDecision(candidate),
		Match:        err == nil && decisionsEqual(sample.live, candidate),
	}
	if err != nil {
		report.CandidateErr = err.Error()
		e.logger.Warn("[Routing] shadow evaluation failed for %s/%s: %v", sample.ctx.Provider, sample.ctx.Model, err)
	}
	e.reporter(report)
}

// Submit queues a sampled comparison without blocking the serving request.
// The evaluation context is copied before returning and is safe to use after
// the request context has been recycled.
func (e *ShadowEvaluator) Submit(routingCtx *rules.EvaluationContext, live *rules.Decision) bool {
	if e == nil || routingCtx == nil || e.closed.Load() || !e.shouldSample() {
		return false
	}
	sample := shadowSample{ctx: cloneEvaluationContext(routingCtx), live: cloneDecision(live)}
	select {
	case e.queue <- sample:
		return true
	default:
		return false
	}
}

func (e *ShadowEvaluator) shouldSample() bool {
	if e.rate == 0 {
		return false
	}
	if e.rate >= shadowSampleBasis {
		return true
	}
	return e.sequence.Add(1)%shadowSampleBasis < e.rate
}

// Close drains queued samples, then stops the evaluator. It is safe to call
// more than once.
func (e *ShadowEvaluator) Close() {
	if e == nil || !e.closed.CompareAndSwap(false, true) {
		return
	}
	close(e.done)
	e.wg.Wait()
}

func cloneEvaluationContext(input *rules.EvaluationContext) *rules.EvaluationContext {
	if input == nil {
		return nil
	}
	output := *input
	output.ModelAttributes = cloneStringMap(input.ModelAttributes)
	output.Metadata = cloneStringMap(input.Metadata)
	output.Headers = cloneStringMap(input.Headers)
	output.QueryParams = cloneStringMap(input.QueryParams)
	output.Fallbacks = append([]configstoreTables.RoutingFallback(nil), input.Fallbacks...)
	// Complexity may depend on request-owned buffers or external providers. A
	// shadow sample must never invoke that work after the request returns.
	output.ComputeComplexity = nil
	// The live resolver may close over the request context. Initial metadata is
	// already copied above; chained targets remain unknown unless the host
	// supplies a request-independent candidate resolver.
	output.ModelInfo = nil
	return &output
}

func cloneStringMap(input map[string]string) map[string]string {
	if len(input) == 0 {
		return nil
	}
	output := make(map[string]string, len(input))
	for key, value := range input {
		output[key] = value
	}
	return output
}

func cloneDecision(input *rules.Decision) *rules.Decision {
	if input == nil {
		return nil
	}
	output := *input
	output.Fallbacks = append([]configstoreTables.RoutingFallback(nil), input.Fallbacks...)
	return &output
}

func decisionsEqual(left, right *rules.Decision) bool {
	if left == nil || right == nil {
		return left == right
	}
	if left.Provider != right.Provider || left.Model != right.Model ||
		left.KeyID != right.KeyID || left.TTFTTimeout != right.TTFTTimeout ||
		left.MatchedRuleID != right.MatchedRuleID || left.MatchedRuleName != right.MatchedRuleName ||
		len(left.Fallbacks) != len(right.Fallbacks) {
		return false
	}
	for index := range left.Fallbacks {
		if left.Fallbacks[index] != right.Fallbacks[index] {
			return false
		}
	}
	return true
}
