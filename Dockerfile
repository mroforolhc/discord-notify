# Install-стадии на полном node:24 (Debian bookworm): в нём есть build-essential
# и python3, поэтому нативный better-sqlite3 (нет prebuilt под Node 24)
# компилируется без доустановки тулчейна. Финальный образ — slim.
FROM node:24 AS deps
WORKDIR /app
COPY package.json yarn.lock .yarnrc.yml ./
RUN corepack enable && yarn install --immutable

FROM node:24-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN corepack enable && yarn build

FROM node:24 AS prod-deps
WORKDIR /app
COPY package.json yarn.lock .yarnrc.yml ./
RUN corepack enable && yarn workspaces focus --production

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY package.json ./

USER node
CMD ["node", "dist/index.js"]
