FROM oven/bun:1.3.14 AS build
WORKDIR /src
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
COPY web ./web
RUN bun run build

FROM oven/bun:1.3.14-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /src/dist ./dist
USER bun
EXPOSE 8090
CMD ["bun", "dist/server/index.js"]
