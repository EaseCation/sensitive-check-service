# API

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

## 路由

### `GET /`

服务基础信息。

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

### `GET /rules`

返回当前可用规则组列表。

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

- `rules`：可传给 `/check` 的规则组名
- `all`：表示匹配当前全部规则组
- `details`：每个规则组的规则数量和编译情况

### `GET /health`

返回服务健康状态和当前规则加载状态。

响应示例：

```json
{
  "success": true,
  "message": "ok",
  "data": {
    "timestamp": "2026-04-02T08:00:00.000Z",
    "g79": {
      "loadedFromCache": true,
      "hasRules": true,
      "hash": "xxx",
      "sourceUrl": "http://...",
      "updatedAt": "2026-04-02T07:13:01.699Z",
      "lastAttemptAt": "2026-04-02T07:13:01.699Z",
      "lastError": null,
      "refreshIntervalMs": 1800000,
      "categoryCount": 5
    }
  }
}
```

### `POST /check`

执行敏感词检测。

请求头：

```text
Content-Type: application/json
```

请求体：

```json
{
  "text": "fuck and shit",
  "rule": "intercept",
  "mode": "all",
  "includeDetails": false
}
```

请求字段：

- `text`：待检测文本，必填，字符串
- `rule`：单个规则组名，可选
- `rules`：多个规则组名数组，可选
- `ruleNames`：`rules` 的兼容别名，可选
- `mode`：匹配模式，可选
  - `all`：在指定规则组内全量匹配，默认值
  - `first`：命中第一条规则后立即停止
- `includeDetails`：是否返回详细命中结果，默认 `false`
- `details`：`includeDetails` 的兼容别名，可选

规则说明：

- `rule`、`rules`、`ruleNames` 三者任选其一即可
- 当传入 `all` 时，会展开为当前全部规则组
- 默认只返回精简结果
- 只有显式传入 `includeDetails: true` 时，才返回 `data.details`

#### 精简响应示例

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

#### 明细响应示例

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

字段说明：

- `pass`：`true` 表示通过，`false` 表示检测到违规内容
- `violationWords`：命中的违规词文本，已去重
- `replacedText`：将命中内容替换为 `*` 之后的文本；未命中时为空字符串
- `hitRuleIds`：命中规则 ID，格式为 `{ruleGroup}-{ruleId}`，例如 `intercept-12`
- `usedTimeMs`：本次检测耗时，单位毫秒

#### 错误响应示例

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
