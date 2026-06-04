# syntax=docker/dockerfile:1.7
FROM node:20-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production
ENV APP_ENV=production
ENV AI_CHAT_STANDARD_MONTHLY_MESSAGE_LIMIT=30
ENV AI_CHAT_CHEAP_MONTHLY_MESSAGE_LIMIT=100

COPY package.json package-lock.json* ./

RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

COPY prisma ./prisma
COPY build ./build
COPY instrument.server.mjs ./instrument.server.mjs

CMD ["npm", "run", "docker-start"]
