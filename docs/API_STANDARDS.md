# API Standards Compatibility

## Current Implementation

### OpenAI API Standards
- ✅ `/v1/chat/completions` - Chat Completions API
- ✅ `/v1/completions` - Legacy Completions API (translates to chat format)
- ✅ `/v1/models` - Models List API
- ✅ `/v1/embeddings` - Embeddings API
- ✅ `/v1/images/generations` - Image Generations API
- ✅ `/v1/images/edits` - Image Edits API (passthrough)
- ✅ `/v1/images/variations` - Image Variations API (passthrough)
- ✅ `/v1/audio/speech` - Text-to-Speech API
- ✅ `/v1/audio/transcriptions` - Speech-to-Text API
- ✅ `/v1/audio/translations` - Audio Translation API
- ✅ `/v1/moderations` - Moderations API
- ✅ `/v1/responses` - Responses API (OpenAI new format)
- ✅ `/v1/responses/compact` - Responses compact route (forwards through dispatcher)
- ✅ `/v1/responses/{id}/compact` - Per-response-ID compact route (compat)
- ✅ `/v1/edits` - Legacy Text Edits API (translates to chat format)
- ✅ `/v1/rerank` - Rerank API (Cohere compatible)
- ✅ `/v1/video/generations` - Video Generation API
- ✅ `/v1/videos/{id}/content` - Video task content retrieval (redirects or returns stored content when available)
- ✅ `/v1/files` - Files API metadata storage (PostgreSQL-backed; binary content storage is not enabled)
- ✅ `/v1/batches` - Batch API metadata storage and cancellation (PostgreSQL-backed; no async executor yet)
- ✅ `/v1/realtime` - WebSocket bidirectional proxy (upstream forwarding with billing/audit)
- ⚠️ Midjourney API (non-standard, `/api/mj/*`)

### Anthropic API Standards
- ✅ `/v1/messages` - Messages API (with streaming and tool use)

### Google Gemini API Standards
- ✅ `/v1beta/models/{model}:generateContent` - Gemini Generate Content
- ✅ `/v1beta/models/{model}:streamGenerateContent` - Gemini Streaming
- ✅ `/v1/models/{model}:embedContent` - Gemini Embeddings

### Alibaba DashScope API Standards
- ✅ `/api/v1/services/aigc/text-generation/generation` - Ali Text Generation
- ✅ `/api/v1/services/aigc/multimodal-embedding/generation` - Ali Embeddings
- ✅ `/api/v1/services/aigc/text2image/image-synthesis` - Ali Image Generation

### Baidu Wenxin API Standards
- ✅ `/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/:model` - Baidu Chat
- ✅ `/rpc/2.0/ai_custom/v1/wenxinworkshop/embeddings/:model` - Baidu Embeddings

### Cohere API Standards
- ✅ `/v1/rerank` - Cohere Rerank API

## Implemented (Previously Missing)

### OpenAI Enterprise API (Full State Machine)
- ✅ `/v1/assistants` - Assistants API CRUD (create, list, retrieve, modify, delete)
- ✅ `/v1/assistants/{id}` - Per-assistant operations
- ✅ `/v1/threads` - Threads API CRUD
- ✅ `/v1/threads/{id}/messages` - Thread Messages API
- ✅ `/v1/threads/{id}/runs` - Runs API (create, list, retrieve, cancel)
- ✅ `/v1/vector_stores` - Vector Stores API CRUD
- ✅ `/v1/vector_stores/{id}/files` - Vector Store Files API
- ✅ `/v1/fine_tuning/jobs` - Fine-tuning Jobs API (create, list, retrieve, cancel)

### Files & Batches (Full Binary Storage)
- ✅ `/v1/files` - Files API with PostgreSQL bytea binary content storage
- ✅ `/v1/files/{id}/content` - Binary file content retrieval
- ✅ `/v1/batches` - Batch API with async executor (pg-boss powered)

## Not Yet Implemented

### Legacy / Deprecated
- ✅ `/v1/fine-tunes` - Legacy fine-tunes compatibility API backed by PostgreSQL `fine_tuning/jobs` state
- ⚠️ Realtime API WebRTC bridge is a documented non-goal for the current pinned route-parity target; Elygate implements the public WebSocket/session surface tracked in `docs/new-api-route-parity.matrix.json`.

## New API Operational Parity

- ✅ Redis-free rate limiting: token/package RPM and RPH counters use PostgreSQL `UNLOGGED rate_limits` with atomic upsert.
- ✅ Channel management fields: test model, OpenAI organization, response time, balance, status-code mapping, auto-ban flag, tag, settings, request parameter override, header override, remark, and channel info.
- ✅ Token management fields: model whitelist switch, IP whitelist alias, RPM, expiry, unlimited quota, token group, cross-group retry, and last accessed timestamp.
- ✅ Route hygiene: routers mounted inside `/v1` do not declare a second `/v1` prefix; covered by `tests/route-prefix.test.ts`.
- ✅ Multi-key channel management: per-key status (enable/disable with reason), polling/random/sequential modes, auto-disable channel when all keys exhausted.
- ✅ Channel tag management: batch tag assignment, enable/disable by tag, tag listing with counts.
- ✅ Channel copy and upstream model sync: detect/apply upstream model changes per channel.
- ✅ Admin frontend: channel and token resource definitions expose all management fields (model limits, IP whitelist, RPM, groups, tags, overrides, etc.).
- ✅ Email system: SMTP-based email sending (nodemailer), email verification, password reset, email binding, universal verification codes.
- ✅ Captcha / human verification: Cloudflare Turnstile, reCAPTCHA, hCaptcha support for registration, login, and password reset.
- ✅ OAuth providers: GitHub, Discord, Telegram, Google, LinuxDo, WeChat, Custom OAuth/OIDC.
- ✅ Payment providers: Stripe, EPay (Alipay), Creem, Waffo - all with webhook verification.
- ✅ Codex OAuth: full start/complete/refresh/usage flow for io.net integration.
- ✅ Data export/import: full config export (channels, options, user groups, vendors) and import via admin API.
- ✅ Database backup status: table row count statistics endpoint.
- ✅ Assistants API: full CRUD state machine backed by PostgreSQL.
- ✅ Threads API: full CRUD with messages and runs.
- ✅ Vector Stores API: full CRUD with file management.
- ✅ Fine-tuning Jobs API: full CRUD with cancel support.
- ✅ Files API: full binary content storage and retrieval via PostgreSQL bytea.
- ✅ Batches API: async executor powered by pg-boss, processes JSONL input files.
- ✅ New API media task route aliases: `/suno/*`, `/kling/v1/*`, `/jimeng`, root `/mj/*`, and `/{mode}/mj/*` are routed without Redis through PostgreSQL-backed task state.

## Provider Support

| Provider | Channel Type | Chat | Embeddings | Images | Audio | Streaming |
|----------|-------------|------|------------|--------|-------|-----------|
| OpenAI | 1 | ✅ | ✅ | ✅ | ✅ | ✅ |
| Azure | 8 | ✅ | ✅ | ✅ | ✅ | ✅ |
| Anthropic | 14 | ✅ | - | - | - | ✅ |
| Baidu | 15 | ✅ | ✅ | - | - | ✅ |
| Zhipu | 16 | ✅ | - | - | - | ✅ |
| Alibaba | 17 | ✅ | ✅ | ✅ | - | ✅ |
| Xunfei | 18 | ✅ | - | - | - | ✅ |
| Gemini | 23 | ✅ | ✅ | - | - | ✅ |
| Midjourney | 24 | - | - | ✅ | - | - |
| Jina | 25 | - | - | - | - | - |
| Suno | 26 | - | - | - | ✅ | - |
| DeepSeek | 31 | ✅ | - | - | - | ✅ |
| Flux | 34 | - | - | ✅ | - | - |
| NVIDIA | 41 | ✅ | ✅ | - | - | ✅ |
| ComfyUI | 100 | - | - | ✅ | - | - |
