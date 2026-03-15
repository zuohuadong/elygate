# Stage 1: Build
FROM oven/bun:1.1 as builder
WORKDIR /app

# Copy workspace configuration
COPY package.json bun.lockb ./
COPY apps/portal/package.json ./apps/portal/
COPY packages/db/package.json ./packages/db/

# Install dependencies
RUN bun install

# Copy source code
COPY apps/portal ./apps/portal
COPY packages/db ./packages/db

# Build the portal
WORKDIR /app/apps/portal
# We use node-adapter in SvelteKit for runtime flexibility
RUN bun run build

# Stage 2: Runtime
FROM node:20-slim
WORKDIR /app

# Install production dependencies for the adapter
COPY --from=builder /app/apps/portal/build /app/build
COPY --from=builder /app/apps/portal/package.json /app/package.json
# If using @sveltejs/adapter-node, we need its shim/dependencies
# BUT for a simple build, the 'build' folder is often self-contained or needs a small entry.
# We'll assume adapter-node is used.

EXPOSE 3000
ENV NODE_ENV=production
ENV PORT=3000

CMD ["node", "build"]
