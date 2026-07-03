FROM node:22-alpine AS builder

WORKDIR /app

RUN npm install -g pnpm

COPY package.json pnpm-lock.yaml ./
RUN npm pkg delete scripts.prepare && \
    pnpm config set strict-dep-builds false && \
    pnpm config set minimum-release-age 0 && \
    pnpm install --frozen-lockfile

# Config dùng chung cho mọi lần build app, hiếm khi đổi — copy riêng để
# không bị cache-bust bởi code app.
COPY tsconfig.json tsconfig.build.json nest-cli.json ./

# libs dùng chung — đổi cái này thì mọi app phía dưới đều phải build lại
# (đúng ý, vì app nào cũng import qua path alias @slack/*), nhưng ít đổi
# hơn nhiều so với code app nên đặt trước.
COPY libs ./libs

# Build từng app RIÊNG (COPY + RUN theo cặp) thay vì gộp 1 RUN cho cả 15 app
# như trước — Docker cache theo layer, đổi 1 dòng code ở 1 app không còn
# làm cache-bust 14 app còn lại. Xếp app hay đổi (message/api-gateway/
# orchestration — đang là trọng tâm phát triển AI orchestration) xuống
# CUỐI: đổi app nào thì chỉ app đó (và app sau nó) build lại, app đứng
# trước vẫn cache-hit.
COPY apps/auth ./apps/auth
RUN pnpm exec nest build auth

COPY apps/user ./apps/user
RUN pnpm exec nest build user

COPY apps/workspace ./apps/workspace
RUN pnpm exec nest build workspace

COPY apps/notification ./apps/notification
RUN pnpm exec nest build notification

COPY apps/channel ./apps/channel
RUN pnpm exec nest build channel

COPY apps/task ./apps/task
RUN pnpm exec nest build task

COPY apps/socket-gateway ./apps/socket-gateway
RUN pnpm exec nest build socket-gateway

COPY apps/video-call ./apps/video-call
RUN pnpm exec nest build video-call

COPY apps/billing ./apps/billing
RUN pnpm exec nest build billing

COPY apps/integrations ./apps/integrations
RUN pnpm exec nest build integrations

COPY apps/canvas ./apps/canvas
RUN pnpm exec nest build canvas

COPY apps/calendar ./apps/calendar
RUN pnpm exec nest build calendar

COPY apps/message ./apps/message
RUN pnpm exec nest build message

COPY apps/api-gateway ./apps/api-gateway
RUN pnpm exec nest build api-gateway

COPY apps/orchestration ./apps/orchestration
RUN pnpm exec nest build orchestration

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
