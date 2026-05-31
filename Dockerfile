FROM node:20-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production
ENV APP_ENV=production
ENV AI_CHAT_STANDARD_MONTHLY_MESSAGE_LIMIT=30
ENV AI_CHAT_CHEAP_MONTHLY_MESSAGE_LIMIT=100

COPY package.json package-lock.json* ./

RUN npm ci

COPY . .

RUN APP_ENV=production npx prisma generate && npm run build && npm prune --omit=dev && npm cache clean --force

CMD ["npm", "run", "docker-start"]
