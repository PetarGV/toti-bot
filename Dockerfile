FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache wget

COPY package.json ./
RUN npm install --omit=dev

COPY src/ ./src/

VOLUME ["/app/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O- http://127.0.0.1:8080/health || exit 1

CMD ["node", "src/index.js"]