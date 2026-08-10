# Default named context for OSS builds. Buildx can replace this stage with
# --build-context enterprise_panel=/path/to/private-panel-module.
FROM scratch AS enterprise_panel
COPY panel/src/enterprise-fallback/index.ts /index.ts

# --- UI Build Stage: Build the Svelte svadmin panel ---
  FROM oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0 AS ui-builder
  WORKDIR /app

  # Apply latest alpine security patches before installing packages
  ARG APK_MIRROR
  RUN if [ -n "$APK_MIRROR" ]; then sed -i "s#https\?://dl-cdn.alpinelinux.org/alpine#$APK_MIRROR#g" /etc/apk/repositories; fi && \
      apk upgrade --no-cache

  # Install panel dependencies before copying source to preserve the dependency layer.
  COPY panel/package.json panel/bun.lock ./
  RUN bun install --frozen-lockfile

  COPY panel/ ./
  COPY docs/ /docs/

  # The named context is isolated from the default repository context and is
  # only present in this build stage. Enterprise jobs point the path argument
  # at /opt/elygate-enterprise-panel/index.ts.
  COPY --from=enterprise_panel / /opt/elygate-enterprise-panel/

  # Build and type-check without the local copy-build step; the next stage embeds out/.
  ARG BIFROST_ENTERPRISE_PANEL_PATH
  ARG BIFROST_REQUIRE_ENTERPRISE_PANEL=false
  ENV BIFROST_ENTERPRISE_PANEL_PATH=$BIFROST_ENTERPRISE_PANEL_PATH \
      BIFROST_REQUIRE_ENTERPRISE_PANEL=$BIFROST_REQUIRE_ENTERPRISE_PANEL
  RUN bunx vite build && bun run check

  # --- Go Build Stage: Compile the Go binary ---
  FROM golang:1.26.5-alpine3.23@sha256:622e56dbc11a8cfe87cafa2331e9a201877271cbff918af53d3be315f3da88cc AS builder
  WORKDIR /app

  # Install dependencies including gcc for CGO and sqlite (with latest security patches)
  ARG APK_MIRROR
  RUN if [ -n "$APK_MIRROR" ]; then sed -i "s#https\?://dl-cdn.alpinelinux.org/alpine#$APK_MIRROR#g" /etc/apk/repositories; fi && \
      apk upgrade --no-cache && \
      apk add --no-cache gcc musl-dev sqlite-dev binutils binutils-gold

  # Set environment for CGO-enabled build (required for go-sqlite3)
  ENV CGO_ENABLED=1 GOOS=linux GOWORK=/app/go.work

  # Seed a minimal workspace from module manifests so dependency download stays
  # cacheable while the binary still compiles the exact monorepo sources below.
  COPY core/go.mod core/go.sum ./core/
  COPY framework/go.mod framework/go.sum ./framework/
  COPY plugins/compat/go.mod plugins/compat/go.sum ./plugins/compat/
  COPY plugins/governance/go.mod plugins/governance/go.sum ./plugins/governance/
  COPY plugins/jsonparser/go.mod plugins/jsonparser/go.sum ./plugins/jsonparser/
  COPY plugins/logging/go.mod plugins/logging/go.sum ./plugins/logging/
  COPY plugins/maxim/go.mod plugins/maxim/go.sum ./plugins/maxim/
  COPY plugins/mocker/go.mod plugins/mocker/go.sum ./plugins/mocker/
  COPY plugins/modelcatalogresolver/go.mod plugins/modelcatalogresolver/go.sum ./plugins/modelcatalogresolver/
  COPY plugins/otel/go.mod plugins/otel/go.sum ./plugins/otel/
  COPY plugins/prompts/go.mod plugins/prompts/go.sum ./plugins/prompts/
  COPY plugins/semanticcache/go.mod plugins/semanticcache/go.sum ./plugins/semanticcache/
  COPY plugins/telemetry/go.mod plugins/telemetry/go.sum ./plugins/telemetry/
  COPY transports/go.mod transports/go.sum ./transports/
  ARG GOPROXY=https://proxy.golang.org,direct
  RUN --mount=type=cache,target=/go/pkg/mod \
      go work init \
      ./core \
      ./framework \
      ./plugins/compat \
      ./plugins/governance \
      ./plugins/jsonparser \
      ./plugins/logging \
      ./plugins/maxim \
      ./plugins/mocker \
      ./plugins/modelcatalogresolver \
      ./plugins/otel \
      ./plugins/prompts \
      ./plugins/semanticcache \
      ./plugins/telemetry \
      ./transports && \
      cd transports && GOPROXY="$GOPROXY" go mod download

  # Copy source code and dependencies
  COPY core/ ./core/
  COPY framework/ ./framework/
  COPY plugins/compat/ ./plugins/compat/
  COPY plugins/governance/ ./plugins/governance/
  COPY plugins/jsonparser/ ./plugins/jsonparser/
  COPY plugins/logging/ ./plugins/logging/
  COPY plugins/maxim/ ./plugins/maxim/
  COPY plugins/mocker/ ./plugins/mocker/
  COPY plugins/modelcatalogresolver/ ./plugins/modelcatalogresolver/
  COPY plugins/otel/ ./plugins/otel/
  COPY plugins/prompts/ ./plugins/prompts/
  COPY plugins/semanticcache/ ./plugins/semanticcache/
  COPY plugins/telemetry/ ./plugins/telemetry/
  COPY transports/ ./transports/

  COPY --from=ui-builder /app/out ./transports/bifrost-http/ui

  # Build the binary with CGO enabled and static SQLite linking
  WORKDIR /app/transports
  ARG VERSION=unknown
  RUN --mount=type=cache,target=/go/pkg/mod \
      --mount=type=cache,target=/root/.cache/go-build \
      GOPROXY="$GOPROXY" go build \
    -ldflags="-w -s -X main.Version=v${VERSION} -extldflags '-static'" \
    -a -trimpath \
    -tags "sqlite_static" \
    -o /app/main \
    ./bifrost-http

  # Verify build succeeded
  RUN test -f /app/main || (echo "Build failed" && exit 1)

  # --- Runtime Stage: Minimal runtime image ---
  FROM alpine:3.23.4@sha256:5b10f432ef3da1b8d4c7eb6c487f2f5a8f096bc91145e68878dd4a5019afde11
  WORKDIR /app

  # Install runtime dependencies for CGO-enabled binary
  # musl: C standard library (required for CGO binaries)
  # libgcc: GCC runtime library
  # ca-certificates: For HTTPS connections
  ARG APK_MIRROR
  RUN if [ -n "$APK_MIRROR" ]; then sed -i "s#https\?://dl-cdn.alpinelinux.org/alpine#$APK_MIRROR#g" /etc/apk/repositories; fi && \
      apk upgrade --no-cache && \
      apk add --no-cache musl libgcc ca-certificates zlib

  # Create data directory and set up user
  COPY --from=builder /app/main .
  COPY --from=builder /app/transports/docker-entrypoint.sh .

  # Getting arguments
  ARG ARG_APP_PORT=8080
  ARG ARG_APP_HOST=0.0.0.0
  ARG ARG_LOG_LEVEL=info
  ARG ARG_LOG_STYLE=json
  ARG ARG_APP_DIR=/app/data

  # Environment variables with defaults (can be overridden at runtime)
  ENV APP_PORT=$ARG_APP_PORT \
    APP_HOST=$ARG_APP_HOST \
    LOG_LEVEL=$ARG_LOG_LEVEL \
    LOG_STYLE=$ARG_LOG_STYLE \
    APP_DIR=$ARG_APP_DIR

  # Go runtime performance tuning (override at runtime for your workload)
  # GOGC: GC target percentage. Higher = less frequent GC, more memory usage.
  #       Default: 100. For high-throughput with available memory, try 200-400.
  # GOMEMLIMIT: Soft memory limit for Go runtime. Set to ~90% of container memory limit.
  #             Example: "1800MiB" for a 2GB container, "3600MiB" for 4GB.
  #             When set, Go will be more aggressive about GC as it approaches this limit.
  # Note: GOMAXPROCS is automatically detected from cgroup CPU limits via automaxprocs.
  ENV GOGC="" \
    GOMEMLIMIT=""


  # adduser -D (no -u) on this alpine base assigns the first free UID, which is
  # 1000 on a fresh image — so the numeric USER 1000:0 below resolves to appuser.
  # Guard the group-writable chmod so it never applies when APP_DIR resolves to
  # /app itself (e.g. --build-arg ARG_APP_DIR=/app), which would make the binary
  # group-0-writable.
  RUN mkdir -p "$APP_DIR/logs" && \
    adduser -D -s /bin/sh appuser && \
    chown -R appuser:appuser /app && \
    chown -R appuser:0 "$APP_DIR" && \
    { [ "$APP_DIR" = "/app" ] || chmod -R g=rwX "$APP_DIR"; } && \
    chmod +x /app/docker-entrypoint.sh
  # Numeric USER (uid:gid) so kubelet can verify runAsNonRoot; group 0 grants
  # write access to the group-0-owned data dir under arbitrary OpenShift UIDs.
  USER 1000:0


  # Declare volume for data persistence
  VOLUME ["${APP_DIR}"]
  EXPOSE $APP_PORT

  # Health check for container status monitoring
  # Uses busybox wget (built into alpine) instead of the standalone wget package
  # to avoid CVE-2025-69194; busybox wget supports -q/-O but not --no-verbose/--tries.
  HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:${APP_PORT}/health || exit 1

  # Use entrypoint script that handles volume permissions and argument processing
  ENTRYPOINT ["/app/docker-entrypoint.sh"]
  CMD ["/app/main"]
