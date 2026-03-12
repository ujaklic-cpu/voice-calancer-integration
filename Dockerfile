# syntax=docker/dockerfile:1
FROM node:18-slim AS deps

WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci --production

# ---- runtime ----
FROM node:18-slim

RUN groupadd --gid 1001 appuser && useradd --uid 1001 --gid 1001 --no-create-home appuser

WORKDIR /usr/src/app

COPY --from=deps /usr/src/app/node_modules ./node_modules
COPY . .

RUN mkdir -p /usr/src/app/data && chown -R appuser:appuser /usr/src/app

USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "server.js"]
