FROM node:22-alpine
ENV NODE_ENV=production TZ=Asia/Jerusalem
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 8088
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8088/healthz || exit 1
CMD ["node", "src/server.js"]
