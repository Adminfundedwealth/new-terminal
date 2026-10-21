FROM node:22-slim

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY . .

# Build server-lib TypeScript to JavaScript
RUN npm run build:server

ENV NODE_ENV=production
EXPOSE 4002

CMD ["node", "proxy-server.mjs"]