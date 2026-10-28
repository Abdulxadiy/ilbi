FROM node:24-bookworm-slim AS development
ENV NODE_ENV=development EXPO_NO_TELEMETRY=1 BROWSER=none
WORKDIR /app
RUN chown node:node /app
USER node
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node scripts/patch-toolchain.cjs ./scripts/
COPY --chown=node:node vendor/deepmerge-4.3.1-prototype-guard.json ./vendor/
RUN npm ci --no-audit --no-fund && sha256sum package.json package-lock.json scripts/patch-toolchain.cjs vendor/deepmerge-4.3.1-prototype-guard.json > node_modules/.ilbi-dependencies.sha256
COPY --chown=node:node . .
EXPOSE 8081 8082
HEALTHCHECK --interval=15s --timeout=5s --start-period=120s \
  CMD node -e "fetch('http://127.0.0.1:8082/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["sh", "./dev-entrypoint.sh"]
