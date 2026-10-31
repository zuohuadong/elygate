package controlplane

import (
	"context"
	"database/sql"
	"encoding/hex"

	"gorm.io/gorm"
)

// Application is historical installation evidence, not process-local readiness.
type RoutingReleaseHistoryEntry struct {
	RoutingReleaseAttempt
	Application *RoutingReleaseApplication `json:"application"`
}

type RoutingReleasePage struct {
	Head     *RoutingReleaseHead          `json:"head"`
	Releases []RoutingReleaseHistoryEntry `json:"releases"`
	Limit    int                          `json:"limit"`
	Offset   int                          `json:"offset"`
}

func (s *Store) ReadRoutingReleasePage(ctx context.Context, limit, offset int) (*RoutingReleasePage, error) {
	page := &RoutingReleasePage{Limit: limit, Offset: offset}
	// PostgreSQL's default READ COMMITTED would mix generations between queries.
	err := s.db(ctx).Transaction(func(tx *gorm.DB) error {
		reader := &Store{tx: tx}
		var err error
		page.Head, err = reader.validatedRoutingReleaseHead(ctx)
		if err != nil {
			return err
		}
		page.Releases, err = reader.ListRoutingReleaseHistory(ctx, limit, offset)
		return err
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return nil, err
	}
	return page, nil
}

func (s *Store) validatedRoutingReleaseHead(ctx context.Context) (*RoutingReleaseHead, error) {
	head, err := s.GetRoutingReleaseHead(ctx)
	if err != nil {
		return nil, err
	}
	if head.Epoch == 0 && head.State == "pending" && head.DesiredVersionID == "" &&
		head.DesiredFingerprint == "" && head.AppliedVersionID == "" && head.AppliedFingerprint == "" {
		return head, nil
	}
	attempt, err := routingReleaseAttemptForHead(s.db(ctx), *head)
	if err != nil {
		return nil, err
	}
	receipts, err := s.routingReleaseHistory(ctx, []RoutingReleaseAttempt{*attempt})
	if err != nil {
		return nil, err
	}
	if head.State == "applied" && head.IsApplied() && receipts[0].Application != nil {
		return head, nil
	}
	if head.State == "pending" && head.AppliedVersionID == "" && head.AppliedFingerprint == "" && receipts[0].Application == nil {
		return head, nil
	}
	return nil, ErrRoutingReleaseNotApplied
}

func (s *Store) ListRoutingReleaseHistory(ctx context.Context, limit, offset int) ([]RoutingReleaseHistoryEntry, error) {
	if limit < 1 || limit > 100 || offset < 0 {
		return nil, ErrRoutingReleaseRequest
	}
	attempts := make([]RoutingReleaseAttempt, 0, limit)
	if err := s.db(ctx).Order("epoch DESC").Limit(limit).Offset(offset).Find(&attempts).Error; err != nil {
		return nil, err
	}
	return s.routingReleaseHistory(ctx, attempts)
}

func (s *Store) routingReleaseHistory(ctx context.Context, attempts []RoutingReleaseAttempt) ([]RoutingReleaseHistoryEntry, error) {
	entries := make([]RoutingReleaseHistoryEntry, 0, len(attempts))
	if len(attempts) == 0 {
		return entries, nil
	}
	byAttempt, err := s.routingReleaseApplications(ctx, attempts)
	if err != nil {
		return nil, err
	}
	for _, attempt := range attempts {
		application := byAttempt[attempt.ID]
		if application != nil && !routingReleaseReceiptMatches(attempt, *application) {
			return nil, ErrRoutingReleaseNotApplied
		}
		attempt.CreatedAt = attempt.CreatedAt.UTC()
		entries = append(entries, RoutingReleaseHistoryEntry{attempt, application})
	}
	return entries, nil
}

func (s *Store) routingReleaseApplications(ctx context.Context, attempts []RoutingReleaseAttempt) (map[string]*RoutingReleaseApplication, error) {
	ids := make([]string, 0, len(attempts))
	for _, attempt := range attempts {
		ids = append(ids, attempt.ID)
	}
	var applications []RoutingReleaseApplication
	if err := s.db(ctx).Where("attempt_id IN ?", ids).Find(&applications).Error; err != nil {
		return nil, err
	}
	byAttempt := make(map[string]*RoutingReleaseApplication, len(applications))
	for index := range applications {
		application := &applications[index]
		application.RecordedAt = application.RecordedAt.UTC()
		byAttempt[application.AttemptID] = application
	}
	return byAttempt, nil
}

func routingReleaseReceiptMatches(attempt RoutingReleaseAttempt, application RoutingReleaseApplication) bool {
	fingerprint, err := hex.DecodeString(application.PolicyFingerprint)
	return err == nil && len(fingerprint) == 32 &&
		application.AttemptID == attempt.ID && application.Epoch == attempt.Epoch &&
		application.VersionID == attempt.VersionID && application.Fingerprint == attempt.Fingerprint &&
		!application.RecordedAt.IsZero()
}
