# API 文档

本文档描述当前服务对外暴露的 HTTP 接口，以及主要返回字段的含义。

## 统一响应格式

成功：

```json
{
  "success": true,
  "message": "ok",
  "data": {}
}
```

失败：

```json
{
  "success": false,
  "message": "error message"
}
```

## 路由总览

- `GET /`：服务基础信息
- `GET /rules`：可用规则组列表
- `GET /health`：服务与规则快照状态
- `POST /check`：敏感词检测

## `GET /`

返回服务基础信息。

响应示例：

```json
{
  "success": true,
  "message": "ok",
  "data": {
    "service": "sensitive-check-service"
  }
}
```

## `GET /rules`

返回当前可用的规则组名称，以及每个规则组的编译情况。

响应示例：

```json
{
  "success": true,
  "message": "ok",
  "data": {
    "count": 6,
    "rules": ["all", "intercept", "nickname", "remind", "replace", "shield"],
    "details": [
      {
        "name": "intercept",
        "patternCount": 165,
        "compiledPatternCount": 165,
        "invalidPatternCount": 0
      }
    ]
  }
}
```

字段说明：

- `count`：规则组数量，不包含虚拟规则组 `all`
- `rules`：可用于 `/check` 的规则组名称；`all` 表示全部规则组
- `details`：每个规则组的编译统计
- `patternCount`：原始规则数
- `compiledPatternCount`：成功预编译的规则数
- `invalidPatternCount`：预编译失败的规则数

## `GET /health`

返回服务状态、当前规则快照状态，以及上一版规则快照的保留情况。

响应示例：

```json
{
  "success": true,
  "message": "ok",
  "data": {
    "timestamp": 1775116800,
    "g79": {
      "snapshotMode": "active",
      "loadedFromCache": true,
      "hasRules": true,
      "hash": "xxx",
      "compiledAt": 1775113981,
      "sourceUrl": "http://...",
      "updatedAt": 1775113981,
      "lastAttemptAt": 1775113981,
      "lastError": null,
      "refreshIntervalMs": 1800000,
      "categoryCount": 5,
      "previousSnapshot": {
        "retained": true,
        "hash": "previous-hash",
        "expiresAt": 1775114161
      }
    }
  }
}
```

字段说明：

- `timestamp`：当前服务时间，Unix 时间戳，单位秒
- `snapshotMode`：当前读取规则时使用的快照来源
  - `active`：当前主快照可用
  - `previous-fallback`：主快照不可用，暂时回退到上一版快照
  - `unavailable`：当前没有可用规则快照
- `loadedFromCache`：当前主快照是否来自本地缓存启动
- `hasRules`：当前是否存在可用规则
- `hash`：当前生效规则快照的哈希
- `compiledAt`：当前生效规则快照的预编译时间，Unix 时间戳，单位秒
- `sourceUrl`：当前规则来源地址
- `updatedAt`：当前生效规则数据更新时间，Unix 时间戳，单位秒
- `lastAttemptAt`：最近一次刷新尝试时间，Unix 时间戳，单位秒
- `lastError`：最近一次刷新或加载失败信息；没有错误时为 `null`
- `refreshIntervalMs`：自动刷新间隔，单位毫秒
- `categoryCount`：当前规则组数量
- `previousSnapshot.retained`：是否还保留上一版规则快照
- `previousSnapshot.hash`：上一版规则快照哈希；未保留时为 `null`
- `previousSnapshot.expiresAt`：上一版规则快照预计释放时间，Unix 时间戳，单位秒；未保留时为 `null`

## `POST /check`

执行敏感词检测。

请求头：

```text
Content-Type: application/json
```

请求体示例：

```json
{
  "text": "fuck and shit",
  "rule": "intercept",
  "mode": "all",
  "preserveFormatting": false,
  "includeDetails": false
}
```

请求字段：

- `text`：待检测文本，必填，字符串
- `rule`：单个规则组名称，可选
- `rules`：多个规则组名称数组，可选
- `ruleNames`：`rules` 的兼容别名，可选
- `mode`：匹配模式，可选
  - `all`：遍历指定规则组内全部规则，默认值
  - `first`：命中第一条规则后立即停止
- `preserveFormatting`：是否在匹配时忽略 Minecraft 格式符（如 `§c`、`§l`），并在 `replacedText` 中保留原有格式，默认 `false`
- `includeDetails`：是否返回详细命中信息，默认 `false`
- `details`：`includeDetails` 的兼容别名，可选

规则说明：

- `rule`、`rules`、`ruleNames` 三者任选其一即可
- 当规则中包含 `all` 时，会自动展开为当前全部规则组
- 当 `preserveFormatting: true` 时，服务会先剥离文本中的 Minecraft 格式符后再做匹配，再把命中的可见字符映射回原文本并替换为 `*`
- 默认只返回精简结果
- 只有显式传入 `includeDetails: true` 时，才会返回 `data.details`

### 精简响应示例

```json
{
  "success": true,
  "message": "ok",
  "data": {
    "pass": false,
    "violationWords": ["fuck", "shit"],
    "replacedText": "**** and ****",
    "hitRuleIds": ["intercept-4", "intercept-6", "intercept-25", "intercept-26"],
    "usedTimeMs": 2.3475
  }
}
```

字段说明：

- `pass`：`true` 表示通过；`false` 表示检测到违规内容
- `violationWords`：命中的违规词文本，已去重
- `replacedText`：将命中内容替换为 `*` 后的文本；未命中时为空字符串；当 `preserveFormatting: true` 且输入包含 Minecraft 格式符时，仅替换可见命中文字，原格式符会保留
- `hitRuleIds`：命中规则完整 ID，格式为 `{ruleGroup}-{ruleId}`，例如 `intercept-12`
- `usedTimeMs`：本次检测耗时，单位毫秒

### 明细响应示例

当 `includeDetails: true` 时：

```json
{
  "success": true,
  "message": "ok",
  "data": {
    "pass": false,
    "violationWords": ["fuck", "shit"],
    "replacedText": "**** and ****",
    "hitRuleIds": ["intercept-4", "intercept-6"],
    "usedTimeMs": 2.3475,
    "details": {
      "hits": [
        {
          "rule": "intercept",
          "id": "4",
          "displayId": "intercept-4",
          "pattern": "(?i)...",
          "violations": ["fuck", "shit"],
          "ranges": [
            {
              "value": "fuck",
              "start": 0,
              "end": 4
            }
          ],
          "replacedText": "**** and ****"
        }
      ]
    }
  }
}
```

明细字段补充：

- `details.hits[].displayId`：命中规则完整 ID，格式同 `hitRuleIds`
- `details.hits[].pattern`：原始规则表达式，仅在 `NODE_ENV=development` 时返回
- `details.hits[].violations`：该条规则命中的违规词
- `details.hits[].ranges`：命中片段的位置区间；当 `preserveFormatting: true` 时，区间基于剥离格式符后的可见文本
- `details.hits[].replacedText`：仅基于这一条规则替换后的文本

## 错误响应示例

`text` 缺失或类型错误：

```json
{
  "success": false,
  "message": "`text` must be a string."
}
```

`rule` / `rules` 未提供：

```json
{
  "success": false,
  "message": "Provide `rule` or `rules`."
}
```

`mode` 非法：

```json
{
  "success": false,
  "message": "`mode` must be `all` or `first`."
}
```

规则名无效：

```json
{
  "success": false,
  "message": "No valid rule names were provided.",
  "availableRules": ["all", "intercept", "nickname", "remind", "replace", "shield"]
}
```

## cURL 示例

获取规则组：

```bash
curl http://localhost:3000/rules
```

默认全量匹配：

```bash
curl -X POST http://localhost:3000/check \
  -H "Content-Type: application/json" \
  -d "{\"text\":\"fuck and shit\",\"rule\":\"intercept\"}"
```

首条命中即停：

```bash
curl -X POST http://localhost:3000/check \
  -H "Content-Type: application/json" \
  -d "{\"text\":\"fuck and shit\",\"rule\":\"intercept\",\"mode\":\"first\"}"
```

返回命中明细：

```bash
curl -X POST http://localhost:3000/check \
  -H "Content-Type: application/json" \
  -d "{\"text\":\"fuck and shit\",\"rule\":\"intercept\",\"mode\":\"all\",\"includeDetails\":true}"
```

保留 Minecraft 颜色/格式符并按可见文本匹配：

```bash
curl -X POST http://localhost:3000/check \
  -H "Content-Type: application/json" \
  -d "{\"text\":\"§l§6E§aC§7明天§c倒§4闭§r§f\",\"rule\":\"nickname\",\"mode\":\"all\",\"preserveFormatting\":true}"
```
