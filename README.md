# Sensitive Check Service

基于 `Bun + Elysia` 的网易敏感词检测服务。

## 快速开始

安装依赖：

```bash
bun install
```

开发模式：

```bash
bun run dev
```

生产构建：

```bash
bun run build
```

生产运行：

```bash
bun run start
```

Docker 二进制构建：

```bash
bun run build:docker
```

Docker 启动：

```bash
docker compose up --build
```

默认监听地址：

```text
http://localhost:3000
```

## 环境变量

- `HOST`：监听地址，默认 `0.0.0.0`
- `PORT`：监听端口，默认 `3000`
- `RULE_CACHE_PATH`：规则缓存文件路径，默认 `./.cache`

## 文档

- API 文档：[docs/api.md](./docs/api.md)
- 部署文档：[docs/deploy.md](./docs/deploy.md)
