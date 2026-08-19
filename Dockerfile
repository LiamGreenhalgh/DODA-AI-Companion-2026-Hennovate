# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /workspace

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY data/generated ./data/generated

RUN corepack pnpm install --frozen-lockfile
RUN corepack pnpm build
RUN corepack pnpm --filter @delaware-scene/server deploy --prod --legacy /runtime/apps/server

FROM node:22-bookworm-slim AS runtime

ARG RELEASE_VERSION=aws-preview
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIRECTORY=/app/data/generated \
    DEMO_MODE=false \
    RELEASE_VERSION=$RELEASE_VERSION

WORKDIR /app
RUN groupadd --gid 10001 app && useradd --uid 10001 --gid app --no-create-home --shell /usr/sbin/nologin app

COPY --from=build --chown=10001:10001 /runtime/apps/server ./apps/server
COPY --from=build --chown=10001:10001 /workspace/apps/web/dist ./apps/web/dist
COPY --from=build --chown=10001:10001 /workspace/data/generated ./data/generated

USER 10001:10001
EXPOSE 3000
CMD ["node", "apps/server/dist/main.js"]
