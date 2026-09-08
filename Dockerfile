###############################################################################
# Stage 1 — build the static site
#
# `npm run build` is `tsc --noEmit && vite build`, so this stage needs the full
# dependency tree (tests are part of tsconfig's `include`) plus the vendored
# Spine 3.5–3.8 runtimes under vendor/. It produces /app/dist.
###############################################################################
FROM node:22-alpine AS build

WORKDIR /app

# Dependencies first, so a source-only change reuses this layer.
COPY package.json package-lock.json ./

# Browsers are only needed by the Playwright test suite, not by the build.
# Skipping the download keeps `npm ci` fast and offline-friendly.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci

# Sources, configs, vendored runtimes and licenses.
COPY . .

RUN npm run build

###############################################################################
# Stage 2 — serve the static site
#
# The application is fully client-side: no backend, no database, no runtime
# environment variables. nginx only has to serve files and handle SPA routing.
###############################################################################
FROM nginx:1.27-alpine AS runtime

LABEL org.opencontainers.image.title="spine-preview-atlas-exporter" \
      org.opencontainers.image.description="Browser-only Spine animation preview and Atlas region PNG exporter (Spine 3.5-4.3)" \
      org.opencontainers.image.version="0.1.0" \
      org.opencontainers.image.licenses="SEE LICENSE IN licenses/"

COPY --from=build /app/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

# Uses busybox wget that ships with nginx:alpine.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
