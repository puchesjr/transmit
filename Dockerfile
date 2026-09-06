# syntax=docker/dockerfile:1
# Cloud Run: always-on Node adapter (`pnpm start` → `node build`).
# CPU must stay allocated between requests so the outbox worker can
# answer Telnyx Call Control and send missed-call SMS.
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
	pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
RUN pnpm prune --prod

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable && groupadd --system kiso && useradd --system --gid kiso --home-dir /app --no-create-home kiso
COPY --from=build --chown=kiso:kiso /app/build ./build
COPY --from=build --chown=kiso:kiso /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build --chown=kiso:kiso /app/node_modules ./node_modules
COPY --from=build --chown=kiso:kiso /app/migrations ./migrations
COPY --from=build --chown=kiso:kiso /app/scripts ./scripts
COPY --from=build --chown=kiso:kiso /app/src ./src
USER kiso
EXPOSE 8080
CMD ["node", "build"]
