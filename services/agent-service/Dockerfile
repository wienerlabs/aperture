FROM node:22-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json* ./
COPY shared/types/package.json shared/types/
COPY services/agent-service/package.json services/agent-service/
RUN npm install --workspace=@aperture/types --workspace=@aperture/agent-service

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/services/agent-service/node_modules ./services/agent-service/node_modules
COPY --from=deps /app/package.json ./package.json
COPY tsconfig.base.json ./
COPY shared/types/ shared/types/
COPY services/agent-service/ services/agent-service/
RUN rm -f shared/types/tsconfig.tsbuildinfo && \
    npm run build --workspace=@aperture/types && \
    npm run build --workspace=@aperture/agent-service

FROM base AS runner
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 appuser
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/shared/types/dist ./shared/types/dist
COPY --from=builder /app/shared/types/package.json ./shared/types/package.json
COPY --from=builder /app/services/agent-service/dist ./services/agent-service/dist
COPY --from=builder /app/services/agent-service/node_modules ./services/agent-service/node_modules
COPY --from=builder /app/services/agent-service/package.json ./services/agent-service/package.json
COPY --from=deps /app/package.json ./package.json

USER appuser
EXPOSE 3004
CMD ["node", "services/agent-service/dist/index.js"]
