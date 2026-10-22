FROM node:20-alpine AS builder
WORKDIR /app

# The administrative key is injected at build time from the instance .env. It
# is never stored in the repository. Vite inlines VITE_* variables into the
# bundle, so the dashboard can authorize its write operations on its own.
ARG VITE_ADMIN_KEY=""
ENV VITE_ADMIN_KEY=$VITE_ADMIN_KEY

# npm workspace: the lockfile is at the repository root, so the build context
# is the repository root.
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
RUN npm ci --workspace=@mcpulse/web --include-workspace-root

COPY apps/web/tsconfig.json ./apps/web/
COPY apps/web/vite.config.ts ./apps/web/
COPY apps/web/index.html ./apps/web/
COPY apps/web/src ./apps/web/src
RUN npm run build --workspace=@mcpulse/web

FROM nginx:alpine AS runner
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
# Rendered by the nginx entrypoint (envsubst) so the administrator allowlist
# can be changed without rebuilding the image.
COPY apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template
# Expands the administrator allowlist before the template is rendered.
COPY apps/web/05-mcpulse-allowlist.sh /docker-entrypoint.d/05-mcpulse-allowlist.sh
RUN chmod +x /docker-entrypoint.d/05-mcpulse-allowlist.sh

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
