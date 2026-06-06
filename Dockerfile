FROM node:22-alpine AS builder

WORKDIR /app

RUN npm install -g pnpm

COPY package.json pnpm-lock.yaml ./
RUN npm pkg delete scripts.prepare && \
    pnpm config set strict-dep-builds false && \
    pnpm config set minimum-release-age 0 && \
    pnpm install --frozen-lockfile

COPY . .

# Build all microservices
RUN pnpm exec nest build api-gateway && \
    pnpm exec nest build auth && \
    pnpm exec nest build user && \
    pnpm exec nest build workspace && \
    pnpm exec nest build notification && \
    pnpm exec nest build channel && \
    pnpm exec nest build task && \
    pnpm exec nest build message && \
    pnpm exec nest build socket-gateway && \
    pnpm exec nest build video-call && \
    pnpm exec nest build billing && \
    pnpm exec nest build integrations && \
    pnpm exec nest build canvas

FROM node:22-alpine

WORKDIR /app

# Install pnpm and pm2 for process management
RUN npm install -g pnpm pm2

COPY --from=builder /app/package.json /app/pnpm-lock.yaml ./
RUN npm pkg delete scripts.prepare && \
    pnpm config set strict-dep-builds false && \
    pnpm config set minimum-release-age 0 && \
    pnpm install --prod --frozen-lockfile

COPY --from=builder /app/dist ./dist
COPY ecosystem.config.js ./

# Expose API and WebSocket ports
EXPOSE 3000 3008

# Start all microservices via PM2
CMD ["pm2-runtime", "ecosystem.config.js"]
