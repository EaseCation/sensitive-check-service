# 部署文档

当前项目以容器方式部署，`Dockerfile` 已改为 Elysia 官方推荐的生产思路：在构建阶段编译 Linux 二进制，在运行阶段使用轻量级 `distroless` 镜像启动。服务本身会：

- 启动时优先读取本地缓存规则
- 无缓存时同步拉取一次 `g79` 规则
- 启动后每 30 分钟自动刷新一次规则
- 将缓存写入容器内的临时文件 `./.cache/g79-rules.json`

说明：

- 缓存是临时缓存，容器重建后丢失是正常的
- 只要平台支持标准 OCI 镜像并允许 HTTP 服务监听端口，就可以部署
- 服务对外暴露的健康检查接口是 `GET /health`

## 零、非 Docker 生产运行

如果只是先在宿主机上按生产方式运行，可以直接：

### 1. 构建产物

```bash
bun run build
```

### 2. 启动服务

```bash
bun run start
```

如果你想本地验证 Bun 编译二进制，也可以执行：

```bash
bun run build:binary
```

如果是给 Docker 预编译 Linux 产物，则使用：

```bash
bun run build:docker
```

## 一、本地 Docker 部署

### 1. 构建并启动

```bash
docker compose up --build -d
```

默认会启动服务：

```text
http://localhost:3000
```

### 2. 查看日志

```bash
docker compose logs -f
```

### 3. 停止服务

```bash
docker compose down
```

### 4. 更新部署

代码更新后重新构建并启动：

```bash
docker compose up --build -d
```

## 二、直接用 Docker 命令部署

### 1. 构建镜像

```bash
docker build -t senstive-check-service:latest .
```

说明：

- 构建阶段执行的是 `bun run build:docker`
- 该脚本会使用 `--target bun-linux-x64` 生成 Linux 可执行文件
- 运行阶段基础镜像使用 `gcr.io/distroless/base`

### 2. 运行容器

```bash
docker run -d \
  --name senstive-check-service \
  -p 3000:3000 \
  -e HOST=0.0.0.0 \
  -e PORT=3000 \
  -e NODE_ENV=production \
  senstive-check-service:latest
```

### 3. 查看日志

```bash
docker logs -f senstive-check-service
```

### 4. 重启容器

```bash
docker restart senstive-check-service
```

## 三、部署到云端容器平台

适用于支持自定义镜像的云平台，例如阿里云函数计算自定义容器、云托管容器服务，或者其他兼容 OCI 的平台。

### 平台侧需要满足

- 允许上传或拉取 Docker 镜像
- 允许容器监听 HTTP 端口
- 对外暴露访问入口或网关
- 允许容器访问外网，用于拉取最新 `g79` 规则

### 推荐配置

- 容器端口：`3000`
- 启动命令：使用镜像默认命令即可
- 健康检查路径：`/health`
- 健康检查协议：HTTP
- 环境变量：
  - `HOST=0.0.0.0`
  - `PORT=3000`
  - `NODE_ENV=production`

### 部署流程

1. 本地构建镜像
2. 推送到你的镜像仓库
3. 在云平台选择“自定义镜像 / 容器镜像”方式创建服务
4. 填入镜像地址
5. 配置端口、环境变量、健康检查
6. 发布上线

## 四、镜像仓库推送示例

以你的私有仓库地址为例：

```bash
docker tag senstive-check-service:latest registry.example.com/senstive-check-service:latest
docker push registry.example.com/senstive-check-service:latest
```

云平台部署时直接填写：

```text
registry.example.com/senstive-check-service:latest
```

## 五、环境变量

- `HOST`：监听地址，默认 `0.0.0.0`
- `PORT`：监听端口，默认 `3000`
- `RULE_CACHE_PATH`：规则缓存文件路径，默认 `./.cache/g79-rules.json`

说明：

- 如果不传 `RULE_CACHE_PATH`，默认缓存到容器工作目录下的 `.cache`
- 如果云平台提供可写临时目录，也可以显式指定到该目录

## 六、上线后自检

### 1. 健康检查

```bash
curl http://your-domain/health
```

### 2. 查看规则列表

```bash
curl http://your-domain/rules
```

### 3. 试跑一次检测

```bash
curl -X POST http://your-domain/check \
  -H "Content-Type: application/json" \
  -d "{\"text\":\"fuck and shit\",\"rule\":\"intercept\"}"
```

## 七、常见注意点

- 容器需要有外网访问能力，否则定时拉取最新规则会失败
- 首次启动如果没有缓存，服务会先拉取规则再进入可用状态
- 缓存只是加速启动，不是持久化数据，不需要单独备份
- 如果平台支持多副本，每个副本都会各自维护一份本地临时缓存
