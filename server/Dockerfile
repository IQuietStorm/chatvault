# Build context = repository root (see infra/docker-compose.yml)
FROM node:20-alpine AS build
WORKDIR /app
COPY shared ./shared
COPY server/package*.json ./server/
WORKDIR /app/server
RUN npm install
# Build the shared contract package first
RUN cd /app/shared && npm install && npm run build
COPY server ./
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/node_modules ./node_modules
COPY --from=build /app/shared ./shared
EXPOSE 3000
CMD ["node", "dist/main.js"]
