# 部署文档

当前项目以容器方式部署：

- 构建阶段编译 Linux 二进制
- 运行阶段使用轻量级 `distroless` 镜像
- 启动时优先读取本地缓存规则
- 没有缓存时会同步拉取一次最新 `g79` 规则
- 启动后每 30 分钟自动刷新一次规则

缓存说明：

- 默认缓存文件为 `./.cache/g79-rules.json`
- 缓存仅用于加速启动，不是持久化数据
- 容器重建后缓存丢失是正常现象

## 刷新机制与优点

当前规则刷新机制有这些特点：

- 启动优先读取本地缓存，减少冷启动等待
- 没有缓存时才会同步拉取远程规则
- 拉到新规则后会先完成解密、解析和预编译
- 只有整套规则都准备成功，才会原子切换到新快照
- 检测请求始终绑定单次请求开始时拿到的规则快照，避免刷新时发生竞态
- 切换完成后，上一版规则快照会继续保留 3 分钟
- 如果刷新失败，服务会继续使用当前可用快照，不会中断检测
- `/health` 可以看到当前快照、上一版快照和刷新状态

## 本地运行

### 非 Docker 方式

构建：

```bash
bun run build
```

启动：

```bash
bun run start
```

如果你要预编译 Docker 使用的 Linux 二进制：

```bash
bun run build:docker
```

### Docker Compose

启动：

```bash
docker compose up --build -d
```

查看日志：

```bash
docker compose logs -f
```

停止：

```bash
docker compose down
```

## 直接使用 Docker

构建镜像：

```bash
docker build -t sensitive-check-service:latest .
```

运行容器：

```bash
docker run -d \
  --name sensitive-check-service \
  -p 3000:3000 \
  -e HOST=0.0.0.0 \
  -e PORT=3000 \
  -e NODE_ENV=production \
  sensitive-check-service:latest
```

查看日志：

```bash
docker logs -f sensitive-check-service
```

重启：

```bash
docker restart sensitive-check-service
```

## 云端容器平台

适用于支持自定义镜像的云平台，例如：

- 阿里云函数计算自定义容器
- 云托管容器服务
- 其他兼容 OCI 的平台

平台至少需要满足：

- 支持拉取或上传 Docker 镜像
- 允许容器监听 HTTP 端口
- 允许容器访问外网，用于刷新 `g79` 规则
- 支持配置健康检查

推荐配置：

- 容器端口：`3000`
- 健康检查路径：`/health`
- 健康检查协议：HTTP
- 环境变量：
  - `HOST=0.0.0.0`
  - `PORT=3000`
  - `NODE_ENV=production`

## 镜像仓库推送

示例：

```bash
docker tag sensitive-check-service:latest registry.example.com/sensitive-check-service:latest
docker push registry.example.com/sensitive-check-service:latest
```

部署时使用镜像地址：

```text
registry.example.com/sensitive-check-service:latest
```

## GitHub Actions 所需配置

仓库变量：

- `ACR_REGISTRY`
- `ACR_NAMESPACE`
- `ACR_REPOSITORY`
- `ALIYUN_REGION`，可选，默认 `cn-hangzhou`
- `ALIYUN_OIDC_PROVIDER_ARN`
- `ALIYUN_FC_DEPLOY_ROLE_ARN`

仓库密钥：

- `ACR_USERNAME`
- `ACR_PASSWORD`
- `FEISHU_WEBHOOK`，可选

## 上线后自检

健康检查：

```bash
curl http://your-domain/health
```

查看规则列表：

```bash
curl http://your-domain/rules
```

执行一次检测：

```bash
curl -X POST http://your-domain/check \
  -H "Content-Type: application/json" \
  -d "{\"text\":\"fuck and shit\",\"rule\":\"intercept\"}"
```

## 注意事项

- 首次启动如果没有缓存，服务会先拉取规则再进入可用状态
- 容器必须可以访问外网，否则规则刷新会失败
- 多副本部署时，每个副本都会维护自己的本地临时缓存
- 如果刷新失败，服务会继续使用当前可用快照，不会中断检测
