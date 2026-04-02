FROM oven/bun:1 AS builder

WORKDIR /app

COPY package.json bun.lock tsconfig.json ./
RUN bun install --frozen-lockfile

COPY src ./src

RUN bun run build:docker && chmod +x /app/server

FROM gcr.io/distroless/base

WORKDIR /app

COPY --from=builder /app/server /app/server

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000

CMD ["/app/server"]
