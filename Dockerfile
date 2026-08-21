# --- JARVIS AI production image -----------------------------------------
# Multi-stage build producing a small runtime image. Requires DATABASE_URL and
# other env vars supplied at runtime (see .env.example). Run migrations with
# `npx prisma migrate deploy` before/at startup.

FROM node:22-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# --- deps ---
FROM base AS deps
COPY package.json package-lock.json* ./
COPY prisma ./prisma
# Use `npm ci` when a lockfile is present, else `npm install`.
RUN if [ -f package-lock.json ]; then npm ci; else npm install --no-audit --no-fund; fi

# --- build ---
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# DATABASE_URL is not needed to build; prisma generate uses the schema only.
RUN npm run build

# --- runtime ---
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/next.config.mjs ./next.config.mjs
EXPOSE 3000
# Apply DB migrations, then start.
CMD ["sh", "-c", "npx prisma migrate deploy && npm run start"]
