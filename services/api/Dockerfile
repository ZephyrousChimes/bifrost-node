# Build context is the repo root (npm workspaces need the root package.json):
#   docker build -f services/api/Dockerfile -t bifrost-api .

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
COPY services/api/package.json services/api/package.json
RUN npm install --workspace services/api
COPY services/api services/api
RUN npm run build --workspace services/api
RUN npm prune --omit=dev --workspace services/api

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/services/api/node_modules ./services/api/node_modules
COPY --from=build /app/services/api/dist ./services/api/dist
COPY --from=build /app/services/api/package.json ./services/api/package.json
COPY --from=build /app/services/api/db ./services/api/db
EXPOSE 8080
CMD ["node", "services/api/dist/server.js"]
