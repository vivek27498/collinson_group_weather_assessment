# syntax=docker/dockerfile:1

# ---- build: compile TypeScript (and generate the Prisma client) with dev dependencies ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
# "prebuild" runs `prisma generate`, then tsc compiles src (including the generated client).
RUN npm run build

# ---- migrate: one-shot job that applies migrations as the DDL-capable `migrator` user ----
FROM build AS migrate
CMD ["npx", "prisma", "migrate", "deploy"]

# ---- runtime: production deps + compiled output only, non-root ----
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:4000/healthz || exit 1
CMD ["node", "dist/index.js"]
