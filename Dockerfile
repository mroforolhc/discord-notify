FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json yarn.lock .yarnrc.yml ./
RUN corepack enable && yarn install --immutable

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN corepack enable && yarn build

FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package.json yarn.lock .yarnrc.yml ./
RUN corepack enable && yarn workspaces focus --production

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

USER node
CMD ["node", "dist/index.js"]
