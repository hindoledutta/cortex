FROM node:lts-slim AS base
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# --- Build stage ---
FROM base AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" npx prisma generate
RUN npm run build

# --- Production stage ---
FROM base AS production
WORKDIR /app
ENV NODE_ENV=production

# Git + OpenSSH client are required at runtime by VaultService (simple-git +
# SSH deploy key). Keeping the install here (not in the `base` stage) isolates
# runtime-only deps and keeps the build image lean.
RUN apt-get update -y && apt-get install -y git openssh-client && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev
# Need prisma CLI + tsx for migrate deploy (release command)
RUN npm install --no-save prisma tsx dotenv

COPY --from=build /app/dist ./dist
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY scripts/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3000
CMD ["/entrypoint.sh"]
