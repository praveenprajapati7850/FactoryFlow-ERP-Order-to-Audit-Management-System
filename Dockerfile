# Multi-stage production Dockerfile for FactoryFlow ERP on Google Cloud Run + Cloud SQL
FROM node:22-slim AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-slim AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm install --no-save tsx

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/src ./src
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/firebase-applet-config.json* ./

# Run as non-root user for Cloud Run security hardening
RUN chown -R node:node /app
USER node

EXPOSE 8080

CMD ["npx", "tsx", "server.ts"]
