package rules

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"sync"
	"sync/atomic"

	"github.com/google/cel-go/cel"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	configstoreTables "github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/framework/routing"
)

// globalScope is the scope name for rules that apply to every request.
const globalScope = "global"

// Store owns the in-memory routing rule set and the compiled CEL programs derived
// from it. Rules are grouped by scope so evaluation walks the scope chain with one map
// lookup per level, and each group is kept sorted by priority ASC (0 is highest) so the
// evaluator can take the first match without re-sorting per request.
type Store interface {
	// HasRules reports whether any rule is cached. It is the per-request gate: when it
	// returns false the request skips rule evaluation entirely.
	HasRules(ctx context.Context) bool
	// GetAllRules returns every cached rule, sorted by priority ascending and, within a
	// priority, newest first. Returned rule objects are read-only.
	GetAllRules(ctx context.Context) []*configstoreTables.TableRoutingRule
	// GetScopedRules returns the enabled rules for one scope level, priority ASC.
	// Returned rules and slices are read-only; edit through UpsertRule instead.
	GetScopedRules(ctx context.Context, scope string, scopeID string) []*configstoreTables.TableRoutingRule
	// GetProgram returns the compiled CEL program for a rule, compiling and caching on
	// first use.
	GetProgram(ctx context.Context, rule *configstoreTables.TableRoutingRule) (cel.Program, error)
	// UpsertRule replaces a rule in the cache, moving it between scopes when its scope
	// changed, and recompiles its program.
	UpsertRule(ctx context.Context, rule *configstoreTables.TableRoutingRule) error
	// DeleteRule drops a rule and its compiled program from the cache.
	DeleteRule(ctx context.Context, id string) error
}

// ReadStore is the read-only part of Store used by one routing evaluation.
// Returned slices and rule objects are borrowed and must not be modified.
type ReadStore interface {
	GetScopedRules(ctx context.Context, scope string, scopeID string) []*configstoreTables.TableRoutingRule
	GetProgram(ctx context.Context, rule *configstoreTables.TableRoutingRule) (cel.Program, error)
}

// Snapshotter lets an evaluator pin one immutable rule/program generation.
// Stores that do not implement it retain the historical per-read behavior.
type Snapshotter interface {
	Snapshot() ReadStore
}

type compiledProgram struct {
	expression string
	program    cel.Program
	err        error
}

type ruleGeneration struct {
	enabledScopes map[string][]*configstoreTables.TableRoutingRule
	allRules      []*configstoreTables.TableRoutingRule
	programs      map[string]compiledProgram
}

// LocalStore is the in-process Store implementation. Writers build a complete
// copy-on-write generation and publish it once; readers only load the atomic
// pointer and never observe a partially updated scope or program cache.
type LocalStore struct {
	current atomic.Pointer[ruleGeneration]
	writer  sync.Mutex
	adHoc   sync.Map // string -> compiledProgram for direct GetProgram callers

	celEnv         *cel.Env // Singleton CEL environment reused for all compilations
	logger         schemas.Logger
	programOptions []cel.ProgramOption
}

// NewSimulationStore creates an empty, isolated cache with bounded CEL evaluation.
// It is never installed in the live routing plugin.
func NewSimulationStore(ctx context.Context, logger schemas.Logger) (*LocalStore, error) {
	store, err := NewLocalStore(ctx, logger, nil)
	if err != nil {
		return nil, err
	}
	store.programOptions = []cel.ProgramOption{cel.CostLimit(10000)}
	return store, nil
}

// NewLocalStore builds the rule cache and warms it from configStore. Every rule's CEL
// program is compiled up front so the first request that matches a rule does not pay
// compilation latency. With no config store there are no rules to serve, and the plugin
// short-circuits on every request.
func NewLocalStore(ctx context.Context, logger schemas.Logger, configStore configstore.ConfigStore) (*LocalStore, error) {
	if logger == nil {
		return nil, fmt.Errorf("logger cannot be nil")
	}

	env, err := createCELEnvironment()
	if err != nil {
		return nil, fmt.Errorf("failed to create CEL environment: %w", err)
	}

	store := &LocalStore{
		celEnv: env,
		logger: logger,
	}

	if configStore != nil {
		rules, err := configStore.GetRoutingRules(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to load routing rules: %w", err)
		}
		if err := store.load(rules); err != nil {
			return nil, fmt.Errorf("failed to copy routing rules: %w", err)
		}
	} else {
		store.current.Store(store.buildGeneration(nil))
	}

	return store, nil
}

// load rebuilds the scope groups and pre-compiles every program. Called once at
// construction; a live edit goes through UpsertRule/DeleteRule instead.
func (rs *LocalStore) load(rules []configstoreTables.TableRoutingRule) error {
	rs.writer.Lock()
	defer rs.writer.Unlock()
	ownedRules := make([]*configstoreTables.TableRoutingRule, 0, len(rules))
	for index := range rules {
		owned, err := cloneRoutingRule(&rules[index])
		if err != nil {
			return err
		}
		ownedRules = append(ownedRules, owned)
	}
	rs.current.Store(rs.buildGeneration(ownedRules))
	return nil
}

// HasRules checks if there are any routing rules configured.
// Quick check to determine if we need to run routing evaluation at all.
func (rs *LocalStore) HasRules(ctx context.Context) bool {
	return len(rs.current.Load().allRules) > 0
}

// GetAllRules gets all routing rules from the in-memory cache.
func (rs *LocalStore) GetAllRules(ctx context.Context) []*configstoreTables.TableRoutingRule {
	rules := rs.current.Load().allRules
	return append([]*configstoreTables.TableRoutingRule(nil), rules...)
}

// GetScopedRules retrieves routing rules by scope and scope ID from the in-memory cache.
// Rules are already sorted by priority ASC (0 is highest priority).
func (rs *LocalStore) GetScopedRules(ctx context.Context, scope string, scopeID string) []*configstoreTables.TableRoutingRule {
	return rs.current.Load().GetScopedRules(ctx, scope, scopeID)
}

// GetProgram returns the installed program when the expression matches. Direct
// callers may also compile an uninstalled rule without changing live routing.
func (rs *LocalStore) GetProgram(ctx context.Context, rule *configstoreTables.TableRoutingRule) (cel.Program, error) {
	if rule == nil {
		return nil, fmt.Errorf("routing rule cannot be nil")
	}

	if cached, ok := rs.current.Load().programs[rule.ID]; ok && cached.expression == rule.CelExpression {
		return cached.program, cached.err
	}

	// Direct callers can compile rules not installed in the store. Keep their
	// cache separate so an old rule ID cannot poison a live generation.
	rs.writer.Lock()
	defer rs.writer.Unlock()
	if cached, ok := rs.adHoc.Load(rule.ID); ok {
		program := cached.(compiledProgram)
		if program.expression == rule.CelExpression {
			return program.program, program.err
		}
	}
	compiled := rs.compileRule(rule)
	rs.adHoc.Store(rule.ID, compiled)
	return compiled.program, compiled.err
}

// Snapshot pins the current immutable generation for one evaluation.
func (rs *LocalStore) Snapshot() ReadStore {
	return rs.current.Load()
}

func (rs *LocalStore) compileRule(rule *configstoreTables.TableRoutingRule) compiledProgram {
	program, err := rs.compileProgram(rule.CelExpression)
	return compiledProgram{expression: rule.CelExpression, program: program, err: err}
}

func (rs *LocalStore) compileProgram(expr string) (cel.Program, error) {
	// Get CEL expression, default to "true" if empty
	if expr == "" {
		expr = "true"
	}

	// Normalize header and param keys to lowercase so CEL expressions match normalized map keys
	expr = routing.NormalizeMapKeysInCEL(expr)

	// Validate expression format
	if err := routing.ValidateCELExpression(expr); err != nil {
		return nil, fmt.Errorf("invalid CEL expression: %w", err)
	}

	// Compile using singleton environment
	ast, issues := rs.celEnv.Compile(expr)
	if issues != nil && issues.Err() != nil {
		return nil, fmt.Errorf("CEL compile error: %s", issues.Err().Error())
	}

	// Create program. Partial evaluation is only needed for complexity rules,
	// where routing treats unavailable complexity_tier as unknown instead of
	// leaking an empty-string sentinel.
	options := append([]cel.ProgramOption(nil), rs.programOptions...)
	if celASTReferencesIdentifier(ast, "complexity_tier") {
		options = append(options, cel.EvalOptions(cel.OptPartialEval))
	}
	program, err := rs.celEnv.Program(ast, options...)
	if err != nil {
		return nil, fmt.Errorf("CEL program creation error: %w", err)
	}

	return program, nil
}

// UpsertRule updates a routing rule in the in-memory cache.
func (rs *LocalStore) UpsertRule(ctx context.Context, rule *configstoreTables.TableRoutingRule) error {
	if rule == nil {
		return fmt.Errorf("routing rule cannot be nil")
	}
	rs.writer.Lock()
	defer rs.writer.Unlock()
	owned, err := cloneRoutingRule(rule)
	if err != nil {
		return err
	}
	current := rs.current.Load()
	nextRules := make([]*configstoreTables.TableRoutingRule, 0, len(current.allRules)+1)
	for _, existing := range current.allRules {
		if existing.ID != rule.ID {
			nextRules = append(nextRules, existing)
		}
	}
	nextRules = append(nextRules, owned)
	next := rs.buildGeneration(nextRules)
	rs.adHoc.Delete(rule.ID)
	rs.current.Store(next)
	return nil
}

// DeleteRule removes a routing rule from the in-memory cache.
func (rs *LocalStore) DeleteRule(ctx context.Context, id string) error {
	rs.writer.Lock()
	defer rs.writer.Unlock()
	current := rs.current.Load()
	nextRules := make([]*configstoreTables.TableRoutingRule, 0, len(current.allRules))
	for _, existing := range current.allRules {
		if existing.ID != id {
			nextRules = append(nextRules, existing)
		}
	}
	rs.adHoc.Delete(id)
	rs.current.Store(rs.buildGeneration(nextRules))
	return nil
}

func (rs *LocalStore) buildGeneration(rules []*configstoreTables.TableRoutingRule) *ruleGeneration {
	generation := &ruleGeneration{
		enabledScopes: make(map[string][]*configstoreTables.TableRoutingRule),
		allRules:      rules,
		programs:      make(map[string]compiledProgram, len(rules)),
	}
	sort.SliceStable(generation.allRules, func(i, j int) bool {
		if generation.allRules[i].Priority != generation.allRules[j].Priority {
			return generation.allRules[i].Priority < generation.allRules[j].Priority
		}
		return generation.allRules[i].CreatedAt.After(generation.allRules[j].CreatedAt)
	})
	previous := rs.current.Load()
	for _, rule := range generation.allRules {
		key := scopeKeyFromRule(rule)
		if rule.EnabledValue() {
			generation.enabledScopes[key] = append(generation.enabledScopes[key], rule)
		}
		if previous != nil {
			if cached, ok := previous.programs[rule.ID]; ok && cached.expression == rule.CelExpression {
				generation.programs[rule.ID] = cached
				continue
			}
		}
		generation.programs[rule.ID] = rs.compileRule(rule)
		if generation.programs[rule.ID].err != nil {
			rs.logger.Warn("Failed to pre-compile routing program for rule %s: %v", rule.Name, generation.programs[rule.ID].err)
		}
	}
	return generation
}

func (generation *ruleGeneration) GetScopedRules(_ context.Context, scope string, scopeID string) []*configstoreTables.TableRoutingRule {
	return generation.enabledScopes[scopeKey(scope, scopeID)]
}

func (generation *ruleGeneration) GetProgram(_ context.Context, rule *configstoreTables.TableRoutingRule) (cel.Program, error) {
	if rule == nil {
		return nil, fmt.Errorf("routing rule cannot be nil")
	}
	cached, ok := generation.programs[rule.ID]
	if !ok {
		return nil, fmt.Errorf("routing rule %q is not part of this generation", rule.ID)
	}
	return cached.program, cached.err
}

func cloneRoutingRule(rule *configstoreTables.TableRoutingRule) (*configstoreTables.TableRoutingRule, error) {
	encoded, err := json.Marshal(rule)
	if err != nil {
		return nil, fmt.Errorf("failed to copy routing rule: %w", err)
	}
	var owned configstoreTables.TableRoutingRule
	if err := json.Unmarshal(encoded, &owned); err != nil {
		return nil, fmt.Errorf("failed to decode routing rule copy: %w", err)
	}
	// These persistence fields are omitted by the public JSON representation.
	owned.Fallbacks = copyRoutingPointer(rule.Fallbacks)
	owned.Query = copyRoutingPointer(rule.Query)
	for index := range owned.Targets {
		owned.Targets[index].RuleID = rule.Targets[index].RuleID
	}
	return &owned, nil
}

func copyRoutingPointer[T any](source *T) *T {
	if source == nil {
		return nil
	}
	owned := *source
	return &owned
}

// scopeKey builds the cache key for a scope level. Global rules always key to "global:"
// regardless of the scope ID they were stored with.
func scopeKey(scope string, scopeID string) string {
	if scope == globalScope {
		return globalScope + ":"
	}
	return scope + ":" + scopeID
}

// scopeKeyFromRule builds the cache key a rule belongs under.
func scopeKeyFromRule(rule *configstoreTables.TableRoutingRule) string {
	scopeID := ""
	if rule.ScopeID != nil {
		scopeID = *rule.ScopeID
	}
	return scopeKey(rule.Scope, scopeID)
}
