FROM node:18-bullseye

WORKDIR /app

COPY package*.json ./

# 🔥 FIX for rollup bug
RUN rm -rf node_modules package-lock.json \
    && npm install --force

COPY . .

# Build server-lib TypeScript to JavaScript
RUN npm run build:server

ENV NODE_ENV=production
EXPOSE 4002

CMD ["node", "proxy-server.mjs"]