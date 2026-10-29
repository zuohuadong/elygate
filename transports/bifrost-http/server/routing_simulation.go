package server

import (
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/handlers"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/lib"
)

func (s *BifrostHTTPServer) registerRoutingSimulationRoute(middlewares ...schemas.BifrostHTTPMiddleware) {
	guarded := append(append([]schemas.BifrostHTTPMiddleware{}, middlewares...), s.ControlPlaneHandler.AdminAccessMiddleware())
	s.Router.POST("/api/control-plane/routing/simulate", lib.ChainMiddlewares(handlers.SimulateRouting, guarded...))
}
