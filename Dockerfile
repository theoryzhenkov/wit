# Deploy unit for tars (ops_atlas manifest app): the one Bun process —
# API + Yjs relay + SSE + editor SPA — on :3000. Durable state lives in
# Postgres; assets under /data (mount a volume, ASSET_DIR=/data/assets).
#
# Install runs inside each stage rather than copying node_modules across:
# bun materializes per-workspace node_modules (.bin shims included), so a
# root-only copy loses the workspace binaries (vite, tsc).
FROM oven/bun:1 AS build
WORKDIR /repo
COPY . .
RUN bun install --frozen-lockfile
RUN cd app && bun run build

FROM oven/bun:1-slim
WORKDIR /repo
ENV NODE_ENV=production PORT=3000 ASSET_DIR=/data/assets
COPY --from=build /repo/package.json /repo/bun.lock ./
COPY --from=build /repo/app/package.json ./app/
COPY --from=build /repo/packages ./packages
COPY --from=build /repo/app/src ./app/src
COPY --from=build /repo/app/drizzle ./app/drizzle
COPY --from=build /repo/app/dist ./app/dist
RUN bun install --frozen-lockfile --production
EXPOSE 3000
WORKDIR /repo/app
CMD ["bun", "src/index.ts"]
