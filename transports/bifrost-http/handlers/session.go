package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/fasthttp/router"
	"github.com/google/uuid"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/framework/encrypt"
	"github.com/maximhq/bifrost/transports/bifrost-http/lib"
	"github.com/valyala/fasthttp"
)

// SessionHandler manages HTTP requests for session operations
type SessionHandler struct {
	configStore   configstore.ConfigStore
	wsTicketStore *WSTicketStore
}

// NewSessionHandler creates a new session handler instance
func NewSessionHandler(configStore configstore.ConfigStore, wsTicketStore *WSTicketStore) *SessionHandler {
	return &SessionHandler{
		configStore:   configStore,
		wsTicketStore: wsTicketStore,
	}
}

// RegisterRoutes registers the session-related routes
func (h *SessionHandler) RegisterRoutes(r *router.Router, middlewares ...schemas.BifrostHTTPMiddleware) {
	r.POST("/api/session/login", lib.ChainMiddlewares(h.login, middlewares...))
	r.POST("/api/session/logout", lib.ChainMiddlewares(h.logout, middlewares...))
	r.GET("/api/session/is-auth-enabled", lib.ChainMiddlewares(h.isAuthEnabled, middlewares...))
	r.POST("/api/session/ws-ticket", lib.ChainMiddlewares(h.issueWSTicket, middlewares...))
}

// isAuthEnabled handles GET /api/session/is-auth-enabled - Check if auth is enabled
func (h *SessionHandler) isAuthEnabled(ctx *fasthttp.RequestCtx) {
	resp := map[string]any{
		"is_auth_enabled": false,
		"has_valid_token": false,
		"auth_type":       "none",
	}

	effectiveAppName := ""
	effectiveShortName := ""
	effectiveEnName := ""
	effectiveLogo := ""
	effectiveFavicon := ""

	if h.configStore != nil {
		if cc, err := h.configStore.GetClientConfig(ctx); err == nil && cc != nil {
			if strings.TrimSpace(cc.AppName) != "" {
				effectiveAppName = strings.TrimSpace(cc.AppName)
			}
		}
		if metadata, err := h.configStore.GetClientMetadata(ctx); err == nil && len(metadata) > 0 {
			if effectiveAppName == "" {
				if v, ok := metadata["app_name"].(string); ok && strings.TrimSpace(v) != "" {
					effectiveAppName = strings.TrimSpace(v)
				} else if v, ok := metadata["brand_name"].(string); ok && strings.TrimSpace(v) != "" {
					effectiveAppName = strings.TrimSpace(v)
				} else if v, ok := metadata["platform_name"].(string); ok && strings.TrimSpace(v) != "" {
					effectiveAppName = strings.TrimSpace(v)
				}
			}
			if v, ok := metadata["short_name"].(string); ok && strings.TrimSpace(v) != "" {
				effectiveShortName = strings.TrimSpace(v)
			} else if v, ok := metadata["brand_short_name"].(string); ok && strings.TrimSpace(v) != "" {
				effectiveShortName = strings.TrimSpace(v)
			}
			if v, ok := metadata["en_name"].(string); ok && strings.TrimSpace(v) != "" {
				effectiveEnName = strings.TrimSpace(v)
			} else if v, ok := metadata["brand_en_name"].(string); ok && strings.TrimSpace(v) != "" {
				effectiveEnName = strings.TrimSpace(v)
			} else if v, ok := metadata["platform_en_name"].(string); ok && strings.TrimSpace(v) != "" {
				effectiveEnName = strings.TrimSpace(v)
			}
			if v, ok := metadata["logo_url"].(string); ok && strings.TrimSpace(v) != "" {
				effectiveLogo = strings.TrimSpace(v)
			} else if v, ok := metadata["app_logo"].(string); ok && strings.TrimSpace(v) != "" {
				effectiveLogo = strings.TrimSpace(v)
			}
			if v, ok := metadata["favicon_url"].(string); ok && strings.TrimSpace(v) != "" {
				effectiveFavicon = strings.TrimSpace(v)
			} else if v, ok := metadata["app_favicon"].(string); ok && strings.TrimSpace(v) != "" {
				effectiveFavicon = strings.TrimSpace(v)
			}
		}
	}

	if effectiveAppName == "" {
		for _, key := range []string{"APP_NAME", "BRAND_NAME", "PLATFORM_NAME", "ELYGATE_APP_NAME", "BIFROST_APP_NAME"} {
			if v := strings.TrimSpace(os.Getenv(key)); v != "" {
				effectiveAppName = v
				break
			}
		}
	}
	if effectiveShortName == "" {
		for _, key := range []string{"APP_SHORT_NAME", "BRAND_SHORT_NAME", "SHORT_NAME"} {
			if v := strings.TrimSpace(os.Getenv(key)); v != "" {
				effectiveShortName = v
				break
			}
		}
	}
	if effectiveEnName == "" {
		for _, key := range []string{"APP_EN_NAME", "BRAND_EN_NAME", "PLATFORM_EN_NAME", "EN_NAME"} {
			if v := strings.TrimSpace(os.Getenv(key)); v != "" {
				effectiveEnName = v
				break
			}
		}
	}
	if effectiveLogo == "" {
		for _, key := range []string{"APP_LOGO", "BRAND_LOGO", "APP_LOGO_URL", "BRAND_LOGO_URL", "LOGO_URL"} {
			if v := strings.TrimSpace(os.Getenv(key)); v != "" {
				effectiveLogo = v
				break
			}
		}
	}
	if effectiveFavicon == "" {
		for _, key := range []string{"APP_FAVICON", "BRAND_FAVICON", "APP_FAVICON_URL", "FAVICON_URL"} {
			if v := strings.TrimSpace(os.Getenv(key)); v != "" {
				effectiveFavicon = v
				break
			}
		}
	}

	if effectiveAppName != "" {
		resp["app_name"] = effectiveAppName
	}
	if effectiveShortName != "" {
		resp["short_name"] = effectiveShortName
	}
	if effectiveEnName != "" {
		resp["en_name"] = effectiveEnName
	}
	if effectiveLogo != "" {
		resp["logo_url"] = effectiveLogo
	}
	if effectiveFavicon != "" {
		resp["favicon_url"] = effectiveFavicon
	}

	if h.configStore == nil {
		SendJSON(ctx, resp)
		return
	}
	authConfig, err := h.configStore.GetAuthConfig(ctx)
	if err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to get auth config: %v", err))
		return
	}
	if authConfig == nil {
		SendJSON(ctx, resp)
		return
	}
	// Check if the header has a token and is valid (Authorization header or cookie)
	token := ""
	if authHeader := string(ctx.Request.Header.Peek("Authorization")); strings.HasPrefix(authHeader, "Bearer ") {
		token = strings.TrimPrefix(authHeader, "Bearer ")
	}
	if token == "" {
		token = string(ctx.Request.Header.Cookie("token"))
	}
	hasValidToken := false
	if token != "" {
		session, err := h.configStore.GetSession(ctx, token)
		if err == nil && session != nil && session.ExpiresAt.After(time.Now()) {
			hasValidToken = true
		}
	}
	resp["is_auth_enabled"] = authConfig.IsEnabled
	resp["has_valid_token"] = hasValidToken
	resp["auth_type"] = dashboardAuthType(authConfig.IsEnabled)
	SendJSON(ctx, resp)
}

// dashboardAuthType reports the dashboard session auth mode for frontend flows.
func dashboardAuthType(isEnabled bool) string {
	if isEnabled {
		return "password"
	}
	return "none"
}

// login handles POST /api/session/login - Login a user
func (h *SessionHandler) login(ctx *fasthttp.RequestCtx) {
	if h.configStore == nil {
		SendError(ctx, fasthttp.StatusForbidden, "Authentication is not enabled")
		return
	}
	payload := struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}{}
	if err := json.Unmarshal(ctx.PostBody(), &payload); err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid request payload")
		return
	}

	// Get auth config
	authConfig, err := h.configStore.GetAuthConfig(ctx)
	if err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to get auth config: %v", err))
		return
	}

	// Check if auth is enabled
	if authConfig == nil || !authConfig.IsEnabled {
		SendError(ctx, fasthttp.StatusForbidden, "Authentication is not enabled")
		return
	}

	// Verify credentials
	if payload.Username != authConfig.AdminUserName.GetValue() {
		SendError(ctx, fasthttp.StatusUnauthorized, "Invalid username or password")
		return
	}
	compare, err := encrypt.CompareHash(authConfig.AdminPassword.GetValue(), payload.Password)
	if err != nil {
		SendError(ctx, fasthttp.StatusUnauthorized, "Unauthorized")
		return
	}
	if !compare {
		SendError(ctx, fasthttp.StatusUnauthorized, "Invalid username or password")
		return
	}

	// Creating a new session
	token := uuid.New().String()
	session := &tables.SessionsTable{
		Token:     token,
		ExpiresAt: time.Now().Add(time.Hour * 24 * 30), // 30 days
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	err = h.configStore.CreateSession(ctx, session)
	if err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to create session: %v", err))
		return
	}

	// Setting cookies
	cookie := fasthttp.AcquireCookie()
	defer fasthttp.ReleaseCookie(cookie)
	cookie.SetKey("token")
	cookie.SetValue(token)
	cookie.SetExpire(time.Now().Add(time.Hour * 24 * 30))
	cookie.SetPath("/")
	cookie.SetHTTPOnly(true)
	cookie.SetSameSite(fasthttp.CookieSameSiteLaxMode)
	// Check if source is https then set secure
	if string(ctx.Request.Header.Peek("X-Forwarded-Proto")) == "https" {
		cookie.SetSecure(true)
	}
	ctx.Response.Header.SetCookie(cookie)

	SendJSON(ctx, map[string]any{
		"message": "Login successful",
	})
}

// logout handles POST /api/session/logout - Logout a user
func (h *SessionHandler) logout(ctx *fasthttp.RequestCtx) {
	if h.configStore == nil {
		SendError(ctx, fasthttp.StatusForbidden, "Authentication is not enabled")
		return
	}
	// Get token from Authorization header
	token := string(ctx.Request.Header.Peek("Authorization"))
	token = strings.TrimPrefix(token, "Bearer ")

	// If no token in header, try to get from cookie
	if token == "" {
		token = string(ctx.Request.Header.Cookie("token"))
	}

	// clear token from cookies
	cookie := fasthttp.AcquireCookie()
	defer fasthttp.ReleaseCookie(cookie)
	cookie.SetKey("token")
	cookie.SetValue("")
	cookie.SetExpire(time.Now().Add(-time.Hour * 24 * 30))
	cookie.SetPath("/")
	cookie.SetHTTPOnly(true)
	cookie.SetSameSite(fasthttp.CookieSameSiteLaxMode)
	// Check if source is https then set secure
	if string(ctx.Request.Header.Peek("X-Forwarded-Proto")) == "https" {
		cookie.SetSecure(true)
	}
	ctx.Response.Header.SetCookie(cookie)

	// delete session from database if token exists
	if token != "" {
		err := h.configStore.DeleteSession(ctx, token)
		if err != nil && !errors.Is(err, configstore.ErrNotFound) {
			logger.Error("failed to delete session during logout: %v", err)
			SendError(ctx, fasthttp.StatusInternalServerError, "Failed to invalidate session. Please try again.")
			return
		}
	}

	SendJSON(ctx, map[string]any{
		"message": "Logout successful",
	})
}

// issueWSTicket handles POST /api/session/ws-ticket - Issue a short-lived ticket for WebSocket auth.
// The caller must already be authenticated (via cookie or Authorization header).
// Returns a one-time-use ticket that the frontend passes as ?ticket= when opening the WebSocket.
func (h *SessionHandler) issueWSTicket(ctx *fasthttp.RequestCtx) {
	if h.wsTicketStore == nil {
		SendError(ctx, fasthttp.StatusServiceUnavailable, "WebSocket tickets are not available")
		return
	}
	sessionToken, ok := ctx.UserValue(schemas.BifrostContextKeySessionToken).(string)
	if !ok {
		SendError(ctx, fasthttp.StatusUnauthorized, "Unauthorized")
		return
	}
	if sessionToken == "" {
		// This is the case where auth is not configured or not enabled
		sessionToken = "dummy-session"
	}
	ticket, err := h.wsTicketStore.Issue(sessionToken)
	if err != nil {
		logger.Error("failed to issue WS ticket: %v", err)
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to issue WebSocket ticket")
		return
	}
	SendJSON(ctx, map[string]any{
		"ticket": ticket,
	})
}
