package logstore

import (
	"context"
	"errors"
)

// ErrUsageLogFingerprintUnsupported is returned by stores that can serve usage
// reconciliation by scanning but cannot produce a cheap snapshot fingerprint.
var ErrUsageLogFingerprintUnsupported = errors.New("usage log fingerprint is not supported by this log store")

// UsageLogFingerprint describes a consistent snapshot of the usage-bearing log
// rows. Two fingerprints are equal only when they describe the same rows, which
// lets reconciliation skip a rescan when nothing changed.
type UsageLogFingerprint struct {
	// Count is the number of usage rows in the snapshot, when the store can
	// report it cheaply; zero means unknown.
	Count int64
	// Digest is an opaque, stable digest of the snapshot contents. Empty means
	// the store cannot provide one.
	Digest string
}

// Equal reports whether two fingerprints describe the same snapshot.
func (f UsageLogFingerprint) Equal(other UsageLogFingerprint) bool {
	return f.Count == other.Count && f.Digest == other.Digest
}

// UsageLogReader is implemented by log stores that can scan usage rows in a
// consistent snapshot, one batch at a time, for usage reconciliation.
type UsageLogReader interface {
	ScanUsageLogs(ctx context.Context, visit func([]Log) error) error
}

// UsageLogSnapshotReader reports whether the last scan observed a complete
// snapshot rather than a best-effort one (for example a bounded scan that hit
// its row limit).
type UsageLogSnapshotReader interface {
	UsageLogSnapshotComplete() bool
}

// UsageLogFingerprintReader produces a fingerprint of the current usage
// snapshot. Stores that cannot implement it return
// ErrUsageLogFingerprintUnsupported.
type UsageLogFingerprintReader interface {
	UsageLogFingerprint(ctx context.Context) (UsageLogFingerprint, error)
}