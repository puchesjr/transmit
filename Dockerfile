# Kiso CRM: one Node process serving the app and draining the Postgres outbox.
# Runs anywhere that has Node and a Postgres 16 URL (Cloud Run, Fly, a VM).
FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN npm install -g pnpm@10

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm build && pnpm prune --prod

FROM base AS runtime
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/scripts/migrate.ts ./scripts/migrate.ts
COPY --from=build /app/src/lib/server/db.ts /app/src/lib/server/env.ts /app/src/lib/server/logger.ts /app/src/lib/server/migrate.ts ./src/lib/server/
COPY --from=build /app/docker/entrypoint.sh ./docker/entrypoint.sh
RUN chmod +x ./docker/entrypoint.sh && chown -R node:node /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["./docker/entrypoint.sh"]
