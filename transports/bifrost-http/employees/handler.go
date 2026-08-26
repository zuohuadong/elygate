package employees

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"mime"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/fasthttp/router"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/framework/encrypt"
	"github.com/maximhq/bifrost/framework/logstore"
	"github.com/maximhq/bifrost/plugins/governance"
	"github.com/maximhq/bifrost/plugins/logging"
	"github.com/maximhq/bifrost/transports/bifrost-http/lib"
	"github.com/valyala/fasthttp"
	"gorm.io/gorm"
)

const employeeCookieName = "employee_token"

const employeeCSRFCookieName = "employee_csrf"

var usernamePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{1,63}$`)

var batchIDPattern = regexp.MustCompile(`^[a-zA-Z0-9._-]{8,64}$`)

var ErrEmployeeInactive = errors.New("employee account is inactive")

type Handler struct {
	store       *Store
	configStore configstore.ConfigStore
	logManager  logging.LogManager
	dummyHash   string
	loginMu     sync.Mutex
	loginLimits map[string]loginLimit
}

type loginLimit struct {
	Attempts int
	ResetAt  time.Time
}

func NewHandler(ctx context.Context, configStore configstore.ConfigStore, logManager logging.LogManager) (*Handler, error) {
	store, err := NewStore(ctx, configStore)
	if err != nil {
		return nil, err
	}
	dummyHash, err := encrypt.Hash("invalid-employee-password-placeholder")
	if err != nil {
		return nil, err
	}
	return &Handler{
		store: store, configStore: configStore, logManager: logManager,
		dummyHash: dummyHash, loginLimits: make(map[string]loginLimit),
	}, nil
}

func (h *Handler) RegisterRoutes(r *router.Router, adminMiddlewares ...schemas.BifrostHTTPMiddleware) {
	r.POST("/employee/api/session/login", h.login)
	r.GET("/employee/api/session", h.sessionStatus)
	r.POST("/employee/api/session/logout", h.logout)
	r.POST("/employee/api/me/password", h.changePassword)
	r.GET("/employee/api/me/keys", h.myKeys)
	r.GET("/employee/api/me/usage", h.myUsage)

	guardedAdminMiddlewares := append(append([]schemas.BifrostHTTPMiddleware{}, adminMiddlewares...), h.AdminAccessMiddleware())

	r.GET("/api/employees", lib.ChainMiddlewares(h.listEmployees, guardedAdminMiddlewares...))
	r.POST("/api/employees", lib.ChainMiddlewares(h.createEmployee, guardedAdminMiddlewares...))
	r.POST("/api/employees/import", lib.ChainMiddlewares(h.importEmployees, guardedAdminMiddlewares...))
	r.DELETE("/api/employees/import/{batch_id}", lib.ChainMiddlewares(h.rollbackImport, guardedAdminMiddlewares...))
	r.PUT("/api/employees/{employee_id}", lib.ChainMiddlewares(h.updateEmployee, guardedAdminMiddlewares...))
	r.POST("/api/employees/{employee_id}/reset-password", lib.ChainMiddlewares(h.resetPassword, guardedAdminMiddlewares...))
}

func (h *Handler) AdminAccessMiddleware() schemas.BifrostHTTPMiddleware {
	return func(next fasthttp.RequestHandler) fasthttp.RequestHandler {
		return func(ctx *fasthttp.RequestCtx) {
			if bypassed, _ := ctx.UserValue(schemas.BifrostContextKeyAuthBypassed).(bool); bypassed {
				sendError(ctx, fasthttp.StatusForbidden, "员工管理要求先启用并登录管理员认证")
				return
			}
			if isAdmin, _ := ctx.UserValue(schemas.IsLocalAdminContextKey).(bool); !isAdmin {
				sendError(ctx, fasthttp.StatusUnauthorized, "员工管理要求管理员身份")
				return
			}
			if !ctx.IsGet() && !ctx.IsHead() {
				mediaType, _, err := mime.ParseMediaType(string(ctx.Request.Header.ContentType()))
				if err != nil || mediaType != "application/json" {
					sendError(ctx, fasthttp.StatusUnsupportedMediaType, "员工管理写请求必须使用 application/json")
					return
				}
				if !sameOriginAdminRequest(ctx) {
					sendError(ctx, fasthttp.StatusForbidden, "员工管理写请求来源无效")
					return
				}
			}
			next(ctx)
		}
	}
}

func sameOriginAdminRequest(ctx *fasthttp.RequestCtx) bool {
	origin := strings.TrimSpace(string(ctx.Request.Header.Peek("Origin")))
	if origin == "" {
		return true
	}
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Host == "" {
		return false
	}
	host := strings.TrimSpace(string(ctx.Request.Header.Peek("X-Forwarded-Host")))
	if host == "" {
		host = string(ctx.Host())
	}
	return strings.EqualFold(parsed.Host, host)
}

func (h *Handler) InferenceAccessMiddleware() schemas.BifrostHTTPMiddleware {
	return func(next fasthttp.RequestHandler) fasthttp.RequestHandler {
		return func(ctx *fasthttp.RequestCtx) {
			virtualKey := governance.ParseVirtualKeyFromFastHTTPRequest(ctx)
			if virtualKey == nil {
				next(ctx)
				return
			}
			virtualKeyID, err := h.virtualKeyID(ctx, *virtualKey)
			if err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) || errors.Is(err, configstore.ErrNotFound) {
					next(ctx)
					return
				}
				sendError(ctx, 500, "员工访问状态校验失败")
				return
			}
			assigned, active, err := h.store.VirtualKeyEmployeeStatus(ctx, virtualKeyID)
			if err != nil {
				sendError(ctx, 500, "员工访问状态校验失败")
				return
			}
			if assigned && !active {
				sendError(ctx, 401, "该员工账号已停用")
				return
			}
			next(ctx)
		}
	}
}

func (h *Handler) CheckVirtualKeyAccess(ctx context.Context, virtualKeyID string) error {
	assigned, active, err := h.store.VirtualKeyEmployeeStatus(ctx, virtualKeyID)
	if err != nil {
		return err
	}
	if assigned && !active {
		return ErrEmployeeInactive
	}
	return nil
}

func (h *Handler) CheckVirtualKeyValueAccess(ctx context.Context, virtualKeyValue string) error {
	virtualKeyID, err := h.virtualKeyID(ctx, virtualKeyValue)
	if errors.Is(err, gorm.ErrRecordNotFound) || errors.Is(err, configstore.ErrNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	return h.CheckVirtualKeyAccess(ctx, virtualKeyID)
}

func (h *Handler) virtualKeyID(ctx context.Context, value string) (string, error) {
	virtualKey, err := h.configStore.GetVirtualKeyByValue(ctx, value)
	if err != nil || virtualKey == nil {
		if err != nil {
			return "", err
		}
		return "", gorm.ErrRecordNotFound
	}
	return virtualKey.ID, nil
}

type employeePayload struct {
	Username          string   `json:"username"`
	Name              string   `json:"name"`
	JobTitle          string   `json:"job_title"`
	Department        string   `json:"department"`
	Applications      string   `json:"applications"`
	AccountType       string   `json:"account_type"`
	IsActive          *bool    `json:"is_active"`
	VirtualKeyIDs     []string `json:"virtual_key_ids"`
	TemporaryPassword string   `json:"temporary_password,omitempty"`
}

func sendJSON(ctx *fasthttp.RequestCtx, value any) {
	ctx.Response.Header.SetContentType("application/json; charset=utf-8")
	data, err := json.Marshal(value)
	if err != nil {
		sendError(ctx, fasthttp.StatusInternalServerError, "响应编码失败")
		return
	}
	ctx.SetBody(data)
}

func sendError(ctx *fasthttp.RequestCtx, status int, message string) {
	ctx.SetStatusCode(status)
	sendJSON(ctx, map[string]string{"error": message})
}

func randomSecret(bytes int) (string, error) {
	buf := make([]byte, bytes)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func temporaryPassword() (string, error) {
	secret, err := randomSecret(15)
	if err != nil {
		return "", err
	}
	return "T9!" + secret, nil
}

func validatePassword(password string) error {
	if len(password) < 12 {
		return errors.New("密码至少需要 12 个字符")
	}
	return nil
}

func validateEmployeePayload(payload employeePayload) error {
	payload.Username = normalizeUsername(payload.Username)
	if !usernamePattern.MatchString(payload.Username) {
		return errors.New("用户名需为 2-64 位小写字母、数字、点、下划线或连字符")
	}
	if strings.TrimSpace(payload.Name) == "" {
		return errors.New("姓名不能为空")
	}
	return nil
}

func (h *Handler) validateVirtualKeys(ctx *fasthttp.RequestCtx, ids []string) error {
	for _, id := range ids {
		if strings.TrimSpace(id) == "" {
			continue
		}
		if _, err := h.configStore.GetVirtualKey(ctx, strings.TrimSpace(id)); err != nil {
			if errors.Is(err, configstore.ErrNotFound) || errors.Is(err, gorm.ErrRecordNotFound) {
				return fmt.Errorf("虚拟密钥不存在: %s", id)
			}
			return err
		}
	}
	return nil
}

func employeeFromPayload(payload employeePayload) Employee {
	isActive := true
	if payload.IsActive != nil {
		isActive = *payload.IsActive
	}
	return Employee{
		Username: normalizeUsername(payload.Username), Name: strings.TrimSpace(payload.Name),
		JobTitle: strings.TrimSpace(payload.JobTitle), Department: strings.TrimSpace(payload.Department),
		Applications: strings.TrimSpace(payload.Applications), AccountType: strings.TrimSpace(payload.AccountType),
		IsActive: isActive,
	}
}

func (h *Handler) listEmployees(ctx *fasthttp.RequestCtx) {
	employees, err := h.store.List(ctx)
	if err != nil {
		sendError(ctx, 500, "读取员工失败")
		return
	}
	views := make([]EmployeeView, 0, len(employees))
	for _, employee := range employees {
		keys, err := h.virtualKeysForEmployee(ctx, employee.ID)
		if err != nil {
			sendError(ctx, 500, "读取员工密钥失败")
			return
		}
		views = append(views, EmployeeView{Employee: employee, VirtualKeys: keys})
	}
	sendJSON(ctx, map[string]any{"employees": views, "total": len(views)})
}

func (h *Handler) createEmployee(ctx *fasthttp.RequestCtx) {
	var payload employeePayload
	if err := json.Unmarshal(ctx.PostBody(), &payload); err != nil {
		sendError(ctx, 400, "请求格式错误")
		return
	}
	if err := validateEmployeePayload(payload); err != nil {
		sendError(ctx, 400, err.Error())
		return
	}
	if len(normalizedAssignmentIDs(payload.VirtualKeyIDs)) != 1 {
		sendError(ctx, 400, "每名员工必须绑定一个专属虚拟密钥")
		return
	}
	if err := h.validateVirtualKeys(ctx, payload.VirtualKeyIDs); err != nil {
		sendError(ctx, 400, err.Error())
		return
	}
	password, err := temporaryPassword()
	if err != nil {
		sendError(ctx, 500, "生成初始密码失败")
		return
	}
	employee := employeeFromPayload(payload)
	if err := h.store.Create(ctx, &employee, password, payload.VirtualKeyIDs); err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			sendError(ctx, 409, "用户名已存在")
			return
		}
		sendError(ctx, 500, "创建员工失败")
		return
	}
	keys, _ := h.virtualKeysForEmployee(ctx, employee.ID)
	sendJSON(ctx, map[string]any{"employee": EmployeeView{Employee: employee, VirtualKeys: keys}, "temporary_password": password})
}

func (h *Handler) importEmployees(ctx *fasthttp.RequestCtx) {
	var request struct {
		BatchID   string            `json:"batch_id"`
		Employees []employeePayload `json:"employees"`
	}
	if err := json.Unmarshal(ctx.PostBody(), &request); err != nil || len(request.Employees) == 0 {
		sendError(ctx, 400, "导入清单不能为空")
		return
	}
	if len(request.Employees) > 500 {
		sendError(ctx, 400, "单次最多导入 500 名员工")
		return
	}
	request.BatchID = strings.TrimSpace(request.BatchID)
	if !batchIDPattern.MatchString(request.BatchID) {
		sendError(ctx, 400, "批次号需为 8-64 位字母、数字、点、下划线或连字符")
		return
	}
	entries := make([]BulkCreateEntry, 0, len(request.Employees))
	credentials := make([]map[string]string, 0, len(request.Employees))
	seenUsers := make(map[string]struct{}, len(request.Employees))
	seenKeys := make(map[string]struct{}, len(request.Employees))
	for _, payload := range request.Employees {
		if err := validateEmployeePayload(payload); err != nil {
			sendError(ctx, 400, err.Error())
			return
		}
		username := normalizeUsername(payload.Username)
		if _, exists := seenUsers[username]; exists {
			sendError(ctx, 400, "导入清单包含重复用户名")
			return
		}
		seenUsers[username] = struct{}{}
		if len(payload.VirtualKeyIDs) != 1 || strings.TrimSpace(payload.VirtualKeyIDs[0]) == "" {
			sendError(ctx, 400, "批量导入要求每名员工恰好绑定一个专属虚拟密钥")
			return
		}
		keyID := strings.TrimSpace(payload.VirtualKeyIDs[0])
		if _, exists := seenKeys[keyID]; exists {
			sendError(ctx, 400, "导入清单包含重复虚拟密钥")
			return
		}
		seenKeys[keyID] = struct{}{}
		if err := h.validateVirtualKeys(ctx, []string{keyID}); err != nil {
			sendError(ctx, 400, err.Error())
			return
		}
		password := payload.TemporaryPassword
		if err := validatePassword(password); err != nil {
			sendError(ctx, 400, "批量导入必须为每名员工提供可重试的一次性密码")
			return
		}
		employee := employeeFromPayload(payload)
		entries = append(entries, BulkCreateEntry{Employee: &employee, Password: password, VirtualKeyIDs: []string{keyID}})
		credentials = append(credentials, map[string]string{"username": username, "temporary_password": password})
	}
	digestPayload, err := json.Marshal(request)
	if err != nil {
		sendError(ctx, 500, "计算导入摘要失败")
		return
	}
	digestBytes := sha256.Sum256(digestPayload)
	digest := hex.EncodeToString(digestBytes[:])
	alreadyImported, err := h.store.BulkCreateImport(ctx, request.BatchID, digest, entries)
	if err != nil {
		if errors.Is(err, ErrImportBatchConflict) {
			sendError(ctx, 409, "批次号已被不同清单使用")
			return
		}
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			sendError(ctx, 409, "员工或虚拟密钥已存在绑定，导入已整批回滚")
			return
		}
		sendError(ctx, 500, "导入失败，已整批回滚")
		return
	}
	sendJSON(ctx, map[string]any{"batch_id": request.BatchID, "imported": len(entries), "already_imported": alreadyImported, "credentials": credentials})
}

func (h *Handler) rollbackImport(ctx *fasthttp.RequestCtx) {
	batchID, _ := ctx.UserValue("batch_id").(string)
	if !batchIDPattern.MatchString(batchID) {
		sendError(ctx, 400, "批次号无效")
		return
	}
	deleted, err := h.store.RollbackImport(ctx, batchID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		sendError(ctx, 404, "导入批次不存在")
		return
	}
	if err != nil {
		sendError(ctx, 409, "导入批次状态不一致，未执行回滚")
		return
	}
	sendJSON(ctx, map[string]any{"batch_id": batchID, "disabled": deleted})
}

func (h *Handler) updateEmployee(ctx *fasthttp.RequestCtx) {
	var payload employeePayload
	if err := json.Unmarshal(ctx.PostBody(), &payload); err != nil {
		sendError(ctx, 400, "请求格式错误")
		return
	}
	if err := validateEmployeePayload(payload); err != nil {
		sendError(ctx, 400, err.Error())
		return
	}
	if len(normalizedAssignmentIDs(payload.VirtualKeyIDs)) != 1 {
		sendError(ctx, 400, "每名员工必须保留一个专属虚拟密钥")
		return
	}
	if err := h.validateVirtualKeys(ctx, payload.VirtualKeyIDs); err != nil {
		sendError(ctx, 400, err.Error())
		return
	}
	employee := employeeFromPayload(payload)
	employee.ID, _ = ctx.UserValue("employee_id").(string)
	if err := h.store.Update(ctx, &employee, payload.VirtualKeyIDs); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			sendError(ctx, 404, "员工不存在")
			return
		}
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			sendError(ctx, 409, "用户名已存在")
			return
		}
		if errors.Is(err, ErrAssignmentImmutable) {
			sendError(ctx, 409, "专属虚拟密钥创建后不可解绑或转移")
			return
		}
		sendError(ctx, 500, "更新员工失败")
		return
	}
	updated, _ := h.store.Get(ctx, employee.ID)
	keys, _ := h.virtualKeysForEmployee(ctx, employee.ID)
	sendJSON(ctx, map[string]any{"employee": EmployeeView{Employee: *updated, VirtualKeys: keys}})
}

func (h *Handler) resetPassword(ctx *fasthttp.RequestCtx) {
	employeeID, _ := ctx.UserValue("employee_id").(string)
	password, err := temporaryPassword()
	if err != nil {
		sendError(ctx, 500, "生成临时密码失败")
		return
	}
	if err := h.store.ResetPassword(ctx, employeeID, password); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			sendError(ctx, 404, "员工不存在")
			return
		}
		sendError(ctx, 500, "重置密码失败")
		return
	}
	sendJSON(ctx, map[string]string{"temporary_password": password})
}

func (h *Handler) login(ctx *fasthttp.RequestCtx) {
	var payload struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.Unmarshal(ctx.PostBody(), &payload); err != nil {
		sendError(ctx, 400, "请求格式错误")
		return
	}
	limitKey := ctx.RemoteAddr().String() + "|" + normalizeUsername(payload.Username)
	if !h.allowLoginAttempt(limitKey) {
		sendError(ctx, 429, "登录尝试过于频繁，请稍后再试")
		return
	}
	employee, err := h.store.GetByUsername(ctx, payload.Username)
	if err != nil {
		// 对不存在的用户执行同成本比较，避免明显的用户名枚举时序差异。
		_, _ = encrypt.CompareHash(h.dummyHash, payload.Password)
		sendError(ctx, 401, "用户名或密码错误")
		return
	}
	if !employee.IsActive {
		sendError(ctx, 403, "账号已停用")
		return
	}
	if employee.LockedUntil != nil && employee.LockedUntil.After(time.Now()) {
		sendError(ctx, 429, "登录失败次数过多，请稍后再试")
		return
	}
	matched, compareErr := encrypt.CompareHash(employee.PasswordHash, payload.Password)
	if compareErr != nil || !matched {
		_ = h.store.RecordFailedLogin(ctx, employee)
		sendError(ctx, 401, "用户名或密码错误")
		return
	}
	token, err := randomSecret(32)
	if err != nil {
		sendError(ctx, 500, "创建会话失败")
		return
	}
	csrf, err := randomSecret(24)
	if err != nil {
		sendError(ctx, 500, "创建会话失败")
		return
	}
	expires := time.Now().Add(12 * time.Hour)
	if err := h.store.CreateSession(ctx, employee.ID, encrypt.HashSHA256(token), encrypt.HashSHA256(csrf), expires); err != nil {
		sendError(ctx, 500, "创建会话失败")
		return
	}
	_ = h.store.RecordSuccessfulLogin(ctx, employee.ID)
	h.clearLoginLimit(limitKey)
	setEmployeeCookie(ctx, token, expires)
	setCSRFCookie(ctx, csrf, expires)
	sendJSON(ctx, map[string]any{"employee": employee, "csrf_token": csrf})
}

func (h *Handler) allowLoginAttempt(key string) bool {
	h.loginMu.Lock()
	defer h.loginMu.Unlock()
	now := time.Now()
	limit := h.loginLimits[key]
	if limit.ResetAt.IsZero() || !limit.ResetAt.After(now) {
		limit = loginLimit{ResetAt: now.Add(15 * time.Minute)}
	}
	if limit.Attempts >= 20 {
		h.loginLimits[key] = limit
		return false
	}
	limit.Attempts++
	h.loginLimits[key] = limit
	return true
}

func (h *Handler) clearLoginLimit(key string) {
	h.loginMu.Lock()
	delete(h.loginLimits, key)
	h.loginMu.Unlock()
}

func setEmployeeCookie(ctx *fasthttp.RequestCtx, value string, expires time.Time) {
	cookie := fasthttp.AcquireCookie()
	defer fasthttp.ReleaseCookie(cookie)
	cookie.SetKey(employeeCookieName)
	cookie.SetValue(value)
	cookie.SetPath("/employee")
	cookie.SetExpire(expires)
	cookie.SetHTTPOnly(true)
	cookie.SetSameSite(fasthttp.CookieSameSiteLaxMode)
	if ctx.IsTLS() || string(ctx.Request.Header.Peek("X-Forwarded-Proto")) == "https" {
		cookie.SetSecure(true)
	}
	ctx.Response.Header.SetCookie(cookie)
}

func clearEmployeeCookie(ctx *fasthttp.RequestCtx) {
	setEmployeeCookie(ctx, "", time.Unix(1, 0))
	setCSRFCookie(ctx, "", time.Unix(1, 0))
}

func setCSRFCookie(ctx *fasthttp.RequestCtx, value string, expires time.Time) {
	cookie := fasthttp.AcquireCookie()
	defer fasthttp.ReleaseCookie(cookie)
	cookie.SetKey(employeeCSRFCookieName)
	cookie.SetValue(value)
	cookie.SetPath("/employee")
	cookie.SetExpire(expires)
	cookie.SetSameSite(fasthttp.CookieSameSiteLaxMode)
	if ctx.IsTLS() || string(ctx.Request.Header.Peek("X-Forwarded-Proto")) == "https" {
		cookie.SetSecure(true)
	}
	ctx.Response.Header.SetCookie(cookie)
}

func (h *Handler) authenticated(ctx *fasthttp.RequestCtx, requireCSRF bool) (*EmployeeSession, *Employee, bool) {
	token := string(ctx.Request.Header.Cookie(employeeCookieName))
	if token == "" {
		sendError(ctx, 401, "请先登录")
		return nil, nil, false
	}
	session, employee, err := h.store.Session(ctx, encrypt.HashSHA256(token))
	if err != nil || employee == nil || !employee.IsActive {
		clearEmployeeCookie(ctx)
		sendError(ctx, 401, "登录已过期")
		return nil, nil, false
	}
	if requireCSRF {
		provided := encrypt.HashSHA256(string(ctx.Request.Header.Peek("X-CSRF-Token")))
		if subtle.ConstantTimeCompare([]byte(provided), []byte(session.CSRFTokenHash)) != 1 {
			sendError(ctx, 403, "请求校验失败")
			return nil, nil, false
		}
	}
	return session, employee, true
}

func (h *Handler) sessionStatus(ctx *fasthttp.RequestCtx) {
	session, employee, ok := h.authenticated(ctx, false)
	if !ok {
		return
	}
	sendJSON(ctx, map[string]any{
		"employee":   employee,
		"expires_at": session.ExpiresAt,
	})
}

func (h *Handler) logout(ctx *fasthttp.RequestCtx) {
	session, _, ok := h.authenticated(ctx, true)
	if !ok {
		return
	}
	_ = h.store.DeleteSession(ctx, session.TokenHash)
	clearEmployeeCookie(ctx)
	ctx.SetStatusCode(fasthttp.StatusNoContent)
}

func (h *Handler) changePassword(ctx *fasthttp.RequestCtx) {
	session, employee, ok := h.authenticated(ctx, true)
	if !ok {
		return
	}
	var payload struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
	}
	if err := json.Unmarshal(ctx.PostBody(), &payload); err != nil {
		sendError(ctx, 400, "请求格式错误")
		return
	}
	if err := validatePassword(payload.NewPassword); err != nil {
		sendError(ctx, 400, err.Error())
		return
	}
	matched, _ := encrypt.CompareHash(employee.PasswordHash, payload.CurrentPassword)
	if !matched {
		sendError(ctx, 401, "当前密码错误")
		return
	}
	if err := h.store.ChangePassword(ctx, employee.ID, payload.NewPassword); err != nil {
		sendError(ctx, 500, "修改密码失败")
		return
	}
	if err := h.store.DeleteOtherSessions(ctx, employee.ID, session.TokenHash); err != nil {
		sendError(ctx, 500, "密码已更新，但会话清理失败，请重新登录")
		return
	}
	sendJSON(ctx, map[string]string{"message": "密码已更新"})
}

func (h *Handler) requirePasswordChanged(ctx *fasthttp.RequestCtx, employee *Employee) bool {
	if employee.MustChangePassword {
		sendError(ctx, 403, "首次登录必须先修改密码")
		return false
	}
	return true
}

func maskKey(value string) string {
	if len(value) <= 12 {
		return "********"
	}
	return value[:8] + "****" + value[len(value)-4:]
}

func (h *Handler) virtualKeysForEmployee(ctx context.Context, employeeID string) ([]VirtualKeyView, error) {
	ids, err := h.store.AssignmentIDs(ctx, employeeID)
	if err != nil {
		return nil, err
	}
	keys := make([]VirtualKeyView, 0, len(ids))
	for _, id := range ids {
		vk, err := h.configStore.GetVirtualKey(ctx, id)
		if err != nil {
			if errors.Is(err, configstore.ErrNotFound) || errors.Is(err, gorm.ErrRecordNotFound) {
				continue
			}
			return nil, err
		}
		keys = append(keys, VirtualKeyView{
			ID: vk.ID, Name: vk.Name, Description: vk.Description, IsActive: vk.IsActiveValue(),
			ExpiresAt: vk.ExpiresAt, MaskedValue: maskKey(vk.Value.GetValue()),
		})
	}
	return keys, nil
}

func (h *Handler) myKeys(ctx *fasthttp.RequestCtx) {
	_, employee, ok := h.authenticated(ctx, false)
	if !ok || !h.requirePasswordChanged(ctx, employee) {
		return
	}
	keys, err := h.virtualKeysForEmployee(ctx, employee.ID)
	if err != nil {
		sendError(ctx, 500, "读取密钥失败")
		return
	}
	sendJSON(ctx, map[string]any{"keys": keys})
}

func resolvePeriod(value string) (time.Time, time.Time, bool) {
	now := time.Now()
	switch value {
	case "1h":
		return now.Add(-time.Hour), now, true
	case "24h":
		return now.Add(-24 * time.Hour), now, true
	case "7d":
		return now.Add(-7 * 24 * time.Hour), now, true
	case "30d", "":
		return now.Add(-30 * 24 * time.Hour), now, true
	default:
		return time.Time{}, time.Time{}, false
	}
}

func (h *Handler) myUsage(ctx *fasthttp.RequestCtx) {
	_, employee, ok := h.authenticated(ctx, false)
	if !ok || !h.requirePasswordChanged(ctx, employee) {
		return
	}
	if h.logManager == nil {
		sendError(ctx, 503, "用量统计服务不可用")
		return
	}
	period := string(ctx.QueryArgs().Peek("period"))
	start, end, valid := resolvePeriod(period)
	if !valid {
		sendError(ctx, 400, "不支持的统计周期")
		return
	}
	if period == "" {
		period = "30d"
	}
	scopes, err := h.store.AssignmentScopes(ctx, employee.ID)
	if err != nil {
		sendError(ctx, 500, "读取密钥范围失败")
		return
	}
	if len(scopes) == 0 {
		sendJSON(ctx, map[string]any{"period": period, "stats": &logstore.SearchStats{}})
		return
	}
	ids := make([]string, 0, len(scopes))
	for _, scope := range scopes {
		ids = append(ids, scope.VirtualKeyID)
		if scope.CreatedAt.After(start) {
			start = scope.CreatedAt
		}
	}
	stats, err := h.logManager.GetStats(ctx, &logstore.SearchFilters{VirtualKeyIDs: ids, StartTime: &start, EndTime: &end})
	if err != nil {
		sendError(ctx, 500, "读取用量失败")
		return
	}
	sendJSON(ctx, map[string]any{"period": period, "stats": stats})
}
