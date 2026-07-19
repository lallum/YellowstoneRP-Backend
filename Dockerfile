FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3100

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
    && node -e "require.resolve('express'); require.resolve('pg'); console.log('StonePine runtime dependencies installed')"

COPY dist ./dist

EXPOSE 3100
CMD ["node", "dist/index.js"]
