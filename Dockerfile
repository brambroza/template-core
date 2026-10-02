# One image recipe for every module: docker build --build-arg APP_DIR=services/sales .
FROM node:22-slim
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile || pnpm install
ARG APP_DIR
ENV APP_DIR=${APP_DIR}
WORKDIR /app/${APP_DIR}
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["pnpm", "start"]
