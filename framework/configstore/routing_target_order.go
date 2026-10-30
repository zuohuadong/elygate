package configstore

import (
	"errors"

	"github.com/maximhq/bifrost/framework/configstore/tables"
)

func validateRoutingTargetPositions(targets []tables.TableRoutingTarget) error {
	// Empty/legacy lists stay unpositioned; explicit lists must be exactly 0..n-1.
	if len(targets) == 0 {
		return nil
	}
	positioned := targets[0].Position != nil
	for index, target := range targets {
		if positioned {
			if target.Position == nil || *target.Position != index {
				return errors.New("routing target positions must follow input order 0..n-1")
			}
		} else if target.Position != nil {
			return errors.New("routing targets must be all positioned or all unpositioned")
		}
	}
	return nil
}
