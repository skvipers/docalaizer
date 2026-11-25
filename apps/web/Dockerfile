FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.6.5 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/core/package.json ./packages/core/
COPY apps/web/package.json ./apps/web/
RUN pnpm install --frozen-lockfile --filter @docalaizer/web...

FROM deps AS build
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
COPY packages ./packages
COPY apps/web ./apps/web
RUN pnpm --filter @docalaizer/web... build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/package.json ./packages/shared/
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/core/package.json ./packages/core/
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=build /app/apps/web/package.json ./apps/web/
COPY --from=build /app/apps/web/next.config.ts ./apps/web/
COPY --from=build /app/apps/web/public ./apps/web/public
COPY --from=build /app/apps/web/.next ./apps/web/.next
COPY --from=build /app/apps/web/node_modules ./apps/web/node_modules

EXPOSE 3000
WORKDIR /app/apps/web
CMD ["pnpm", "start"]
