FROM --platform=$BUILDPLATFORM node:22-alpine AS deps

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

FROM node:22-alpine

ENV NODE_ENV=production \
	PORT=7000

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

USER node
EXPOSE 7000

HEALTHCHECK --interval=60s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||7000)+'/manifest.json').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]