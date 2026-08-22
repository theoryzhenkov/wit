# Deploy unit for tars (ops_atlas manifest app): the one Bun process —
# API + Yjs relay + SSE + editor SPA — on :3000. Durable state lives in
# Postgres; assets under /data (mount a volume, ASSET_DIR=/data/assets).
FROM oven/bun:1 AS deps
WORKDIR /repo
COPY package.json bun.lock ./
COPY app/package.json ./app/
COPY packages/client/package.json ./packages/client/
COPY packages/cli/package.json ./packages/cli/
COPY packages/astro/package.json ./packages/astro/
RUN bun install --frozen-lockfile

FROM oven/bun:1 AS build
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY . .
RUN cd app && bun run build

FROM oven/bun:1-slim
WORKDIR /repo
ENV NODE_ENV=production PORT=3000 ASSET_DIR=/data/assets
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/app/package.json ./app/
COPY --from=build /repo/app/src ./app/src
COPY --from=build /repo/app/drizzle ./app/drizzle
COPY --from=build /repo/app/dist ./app/dist
COPY --from=build /repo/packages ./packages
EXPOSE 3000
WORKDIR /repo/app
CMD ["bun", "src/index.ts"]
