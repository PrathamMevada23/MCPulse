FROM node:20-alpine AS builder
WORKDIR /app

# The project is an npm workspace: the lockfile lives in the repository root,
# so the build context is the repository root.
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
RUN npm ci --workspace=@mcpulse/api --include-workspace-root

COPY tsconfig.base.json ./
COPY apps/api/tsconfig.json ./apps/api/
COPY apps/api/src ./apps/api/src
RUN npm run build --workspace=@mcpulse/api

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
RUN npm ci --omit=dev --workspace=@mcpulse/api

COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY apps/api/migrations ./apps/api/migrations

EXPOSE 3001
CMD ["node", "apps/api/dist/server.js"]
