# --- Build-Stage: Vite-Produktionsbuild (statisches HTML/JS/CSS) --------------------------
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- Runtime-Stage: nginx liefert die statischen Dateien aus und leitet /api ans Backend weiter --
FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
