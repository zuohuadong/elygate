package configstore

import (
	"context"

	"github.com/maximhq/bifrost/framework/configstore/tables"
	"gorm.io/gorm"
)

// GetPluginsBestEffort is reserved for the administrative recovery endpoint. It
// hydrates each plugin independently so one unreadable config row cannot hide the
// healthy rows that an administrator needs in order to diagnose or delete it.
// Startup and config synchronization continue to use GetPlugins and therefore stay
// fail-closed when any persisted plugin configuration is corrupt.
func (s *RDBConfigStore) GetPluginsBestEffort(ctx context.Context) ([]*tables.TablePlugin, map[string]error, error) {
	db := s.DB().WithContext(ctx)
	var stored []tables.TablePlugin
	if err := db.Session(&gorm.Session{SkipHooks: true}).Find(&stored).Error; err != nil {
		return nil, nil, err
	}

	plugins := make([]*tables.TablePlugin, 0, len(stored))
	diagnostics := make(map[string]error)
	for i := range stored {
		plugin := stored[i]
		if err := plugin.AfterFind(db); err != nil {
			diagnostics[plugin.Name] = err
			plugin.Config = map[string]any{}
		}
		plugins = append(plugins, &plugin)
	}
	return plugins, diagnostics, nil
}

// PluginRecordExistsDirect checks for a stored plugin without hydrating its
// configuration. Administrative deletion uses this to avoid unloading a
// runtime-only plugin while still allowing recovery from malformed config_json.
func (s *RDBConfigStore) PluginRecordExistsDirect(ctx context.Context, name string) (bool, error) {
	var count int64
	if err := s.DB().WithContext(ctx).Session(&gorm.Session{SkipHooks: true}).Model(&tables.TablePlugin{}).
		Where("name = ?", name).Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

// DeletePluginDirect removes a plugin row without hydrating its configuration.
// This is intentionally separate from DeletePlugin so administrators can recover
// from an unreadable encrypted or malformed config_json value.
func (s *RDBConfigStore) DeletePluginDirect(ctx context.Context, name string) error {
	result := s.DB().WithContext(ctx).Session(&gorm.Session{SkipHooks: true}).
		Where("name = ?", name).Delete(&tables.TablePlugin{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}
