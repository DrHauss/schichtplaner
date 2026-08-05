# --- Build-Stage: TypeScript kompilieren, native Bindings (better-sqlite3) bauen -----------
# node:20-bookworm-slim statt einem Alpine-Image, damit die fuer glibc gebauten nativen
# Bindings von better-sqlite3 in der Runtime-Stage garantiert kompatibel sind (Alpine nutzt musl).
FROM node:20-bookworm-slim AS build
WORKDIR /app

# better-sqlite3 laedt bevorzugt ein vorkompiliertes Binary (prebuild-install); ist fuer die
# Ziel-Architektur keins verfuegbar, faellt npm auf einen lokalen node-gyp-Build zurueck -- dafuer
# werden diese Werkzeuge benoetigt. Sie landen NICHT im Runtime-Image (siehe unten).
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
# Entwicklungsabhaengigkeiten (tsx, typescript, @types/*) werden fuer den Betrieb nicht gebraucht --
# prune entfernt sie, ohne die bereits gebauten nativen Bindings erneut zu kompilieren.
RUN npm prune --omit=dev

# --- Runtime-Stage: schlankes Image ohne Compiler-Werkzeuge --------------------------------
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

# Enthaelt die SQLite-Datenbank -- als Volume gemountet, damit sie Deploys/Neustarts uebersteht
# (siehe docker-compose.yml).
VOLUME ["/app/data"]

EXPOSE 4000
CMD ["node", "dist/index.js"]
