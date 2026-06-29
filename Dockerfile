FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3100

# Install only runtime dependencies from package.json.
# We intentionally do NOT copy package-lock.json because the current GitHub lock file is broken/empty.
COPY package.json ./

RUN npm cache clean --force \
    && rm -rf node_modules package-lock.json npm-shrinkwrap.json \
    && npm install --omit=dev --no-audit --no-fund --no-package-lock \
    && node -e "require.resolve('express'); require.resolve('pg'); console.log('Runtime dependencies installed OK')"

# Copy the compiled backend files that already exist in the repo.
COPY dist ./dist

EXPOSE 3100

CMD ["node", "dist/index.js"]
