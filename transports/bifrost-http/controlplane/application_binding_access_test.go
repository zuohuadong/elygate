package controlplane

import (
	"context"
	"testing"
	"time"

	"github.com/maximhq/bifrost/core/schemas"
	configtables "github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/stretchr/testify/require"
)

func TestVirtualKeyAccessBindingModes(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	ctx := context.Background()
	project := &Project{Name: "Binding policy"}
	require.NoError(t, store.CreateProject(ctx, project))

	// Cover unbound, active, revoked and expired keys through both checker APIs.
	for _, state := range []string{"unbound", "active", "revoked", "expired"} {
		active := true
		keyID, keyValue := "vk-policy-"+state, "sk-bf-policy-"+state
		require.NoError(t, cs.CreateVirtualKey(ctx, &configtables.TableVirtualKey{
			ID: keyID, Name: keyID, Value: *schemas.NewSecretVar(keyValue),
			IsActive: &active, CreatedAt: time.Now(), UpdatedAt: time.Now(),
		}))
		if state != "unbound" {
			app := &Application{ProjectID: project.ID, Name: state}
			require.NoError(t, store.CreateApplication(ctx, app))
			var expiresAt *time.Time
			if state == "expired" {
				expired := time.Now().UTC().Add(-time.Minute)
				expiresAt = &expired
			}
			_, err := store.BindVirtualKey(ctx, app.ID, keyID, expiresAt)
			require.NoError(t, err)
			if state == "revoked" {
				require.NoError(t, store.RevokeBinding(ctx, app.ID))
			}
		}
		for _, mode := range []ApplicationBindingMode{ApplicationBindingDisabled, ApplicationBindingOptional, ApplicationBindingRequired} {
			t.Run(state+"/"+string(mode), func(t *testing.T) {
				store.bindingMode = mode
				handler := NewHandler(store, nil)
				var wantError string
				if mode != ApplicationBindingDisabled {
					switch state {
					case "unbound":
						if mode == ApplicationBindingRequired {
							wantError = "application credential binding is required"
						}
					case "revoked", "expired":
						wantError = "application credential binding is revoked or expired"
					}
				}
				for _, accessErr := range []error{
					store.CheckVirtualKeyAccess(ctx, keyID),
					store.CheckVirtualKeyValueAccess(ctx, keyValue),
					handler.CheckVirtualKeyAccess(ctx, keyID),
					handler.CheckVirtualKeyValueAccess(ctx, keyValue),
				} {
					if wantError == "" {
						require.NoError(t, accessErr)
					} else {
						require.EqualError(t, accessErr, wantError)
					}
				}
			})
		}
	}
}

func TestVirtualKeyAccessBindingDisabledDoesNotReadStorage(t *testing.T) {
	store := &Store{bindingMode: ApplicationBindingDisabled}
	handler := NewHandler(store, nil)
	require.NoError(t, handler.CheckVirtualKeyAccess(context.Background(), "vk-disabled"))
	require.NoError(t, handler.CheckVirtualKeyValueAccess(context.Background(), "sk-bf-disabled"))
}

func TestVirtualKeyAccessBindingUnknownID(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	for _, mode := range []ApplicationBindingMode{ApplicationBindingOptional, ApplicationBindingRequired, ApplicationBindingDisabled} {
		t.Run(string(mode), func(t *testing.T) {
			store.bindingMode = mode
			for _, keyID := range []string{"", "missing-key"} {
				err := NewHandler(store, nil).CheckVirtualKeyAccess(context.Background(), keyID)
				if mode == ApplicationBindingRequired {
					require.EqualError(t, err, "application credential binding is required")
				} else {
					require.NoError(t, err)
				}
			}
		})
	}
}

func TestVirtualKeyAccessBindingRequiredAfterRotation(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	store.bindingMode = ApplicationBindingRequired
	ctx := context.Background()
	project := &Project{Name: "Rotation"}
	require.NoError(t, store.CreateProject(ctx, project))
	app := &Application{ProjectID: project.ID, Name: "Worker"}
	require.NoError(t, store.CreateApplication(ctx, app))
	created, err := store.CreateApplicationKey(ctx, app.ID, "worker", "", nil, "admin")
	require.NoError(t, err)
	rotated, err := store.RotateApplicationKey(ctx, app.ID, created.VirtualKeyID, "admin")
	require.NoError(t, err)
	require.Equal(t, created.VirtualKeyID, rotated.VirtualKeyID)
	handler := NewHandler(store, nil)
	require.NoError(t, handler.CheckVirtualKeyAccess(ctx, rotated.VirtualKeyID))
	require.NoError(t, handler.CheckVirtualKeyValueAccess(ctx, rotated.Value))
	require.EqualError(t, handler.CheckVirtualKeyValueAccess(ctx, created.Value), "virtual key has been revoked or rotated")
}

func TestVirtualKeyAccessBindingStorageFailure(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	handler := NewHandler(store, nil)
	for _, mode := range []ApplicationBindingMode{ApplicationBindingOptional, ApplicationBindingRequired, ApplicationBindingDisabled} {
		t.Run(string(mode), func(t *testing.T) {
			store.bindingMode = mode
			err := handler.CheckVirtualKeyAccess(ctx, "vk-policy")
			if mode == ApplicationBindingDisabled {
				require.NoError(t, err)
			} else {
				require.ErrorIs(t, err, context.Canceled)
			}
		})
	}
}
