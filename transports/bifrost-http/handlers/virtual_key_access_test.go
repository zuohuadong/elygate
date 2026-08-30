package handlers

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/require"
)

type recordingVirtualKeyChecker struct {
	name  string
	seen  *[]string
	errID error
	errV  error
}

func (c recordingVirtualKeyChecker) CheckVirtualKeyAccess(_ context.Context, id string) error {
	*c.seen = append(*c.seen, c.name+":id:"+id)
	return c.errID
}

func (c recordingVirtualKeyChecker) CheckVirtualKeyValueAccess(_ context.Context, value string) error {
	*c.seen = append(*c.seen, c.name+":value:"+value)
	return c.errV
}

func TestCompositeVirtualKeyAccessCheckerFiltersNilAndShortCircuits(t *testing.T) {
	seen := []string{}
	wantErr := errors.New("denied")
	checker := NewCompositeVirtualKeyAccessChecker(
		nil,
		recordingVirtualKeyChecker{name: "first", seen: &seen},
		recordingVirtualKeyChecker{name: "second", seen: &seen, errID: wantErr},
		recordingVirtualKeyChecker{name: "third", seen: &seen},
	)
	require.ErrorIs(t, checker.CheckVirtualKeyAccess(context.Background(), "vk-1"), wantErr)
	require.Equal(t, []string{"first:id:vk-1", "second:id:vk-1"}, seen)

	seen = nil
	checker = NewCompositeVirtualKeyAccessChecker(
		recordingVirtualKeyChecker{name: "first", seen: &seen},
		recordingVirtualKeyChecker{name: "second", seen: &seen, errV: wantErr},
	)
	require.ErrorIs(t, checker.CheckVirtualKeyValueAccess(context.Background(), "sk-1"), wantErr)
	require.Equal(t, []string{"first:value:sk-1", "second:value:sk-1"}, seen)
}

func TestCompositeVirtualKeyAccessCheckerReturnsNilWhenEmpty(t *testing.T) {
	require.Nil(t, NewCompositeVirtualKeyAccessChecker(nil))
}
