---
title: FIM Completions API
---

# FIM Completions API

一等入站 FIM Completions 协议（`openai_fim_completions`）。协议所有者：`Fim`。
与聊天路径 `/v1/messages`、`/v1/chat/completions`、`/v1/responses` **独立的流水线**。

典型客户端（例如 [Zed](https://zed.dev) Edit Prediction 的 Codestral 提供商）使用
**Codestral** 请求/响应线格式。CCR 保持该客户端契约，并可路由到 Codestral 本身，
或 DeepSeek。

## 端点

| 路径 | 方法 |
|------|------|
| `/v1/fim/completions` | POST |
| `/fim/completions` | POST（别名） |

## 客户端请求（v1）

仅 Codestral/Mistral 形态 — `prompt` + 可选 `suffix`。不做入站模板自动检测。

```json
{
  "model": "codestral-latest",
  "prompt": "def add(a, b):\n",
  "suffix": "\n    return result",
  "max_tokens": 128,
  "temperature": 0.2,
  "stream": false
}
```

裸 `model` 经 `Router.fim`（再回退 `Router.default`）解析。推荐显式 `provider,model`。

## 客户端响应（v1）

响应线格式匹配**入站** kind。v1 入站为 Codestral/Mistral，因此客户端收到
Codestral 形态 JSON — 即使上游是 DeepSeek（跨族编码）。同族
Codestral→Codestral 为响应透传（不重塑）。

```json
{
  "id": "…",
  "object": "chat.completion",
  "model": "…",
  "created": 1718659669,
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 5,
    "total_tokens": 15
  },
  "choices": [
    {
      "index": 0,
      "message": { "role": "assistant", "content": "    result = a + b" },
      "finish_reason": "stop"
    }
  ]
}
```

| 路径 | 请求 | 响应 |
|------|------|------|
| Codestral（`fim.mistral`） | 同族 body 透传 | 同族透传（上游 Codestral 线格式不变） |

流式 SSE 同样按入站 kind 编码。Zed 等客户端当前以 `"stream": false` 调用 FIM。

日后加入 DeepSeek **入站**时，客户端响应将跟随该入站线格式，而不再固定为 Codestral。

---

## 配置：Codestral

编辑器说 Codestral FIM、希望 CCR 代理 Mistral API（鉴权重写、路由、可选 fallback）时使用。

### 1. 提供商

专用 FIM 条目 — **不要**在同一提供商上叠加聊天 `mistral`：

```json
{
  "name": "codestral-fim",
  "api_base_url": "https://codestral.mistral.ai/v1/fim/completions",
  "api_key": "$CODESTRAL_API_KEY",
  "models": ["codestral-latest"],
  "transformer": { "use": ["fim.mistral"] }
}
```

`fim.mistral` 仅设置 URL + `Authorization: Bearer …`。JSON body 原样透传（同族透传）。

### 2. Router

```json
"Router": {
  "fim": "codestral-fim,codestral-latest"
}
```

### 3. 将客户端指向 CCR

示例（Zed Edit Prediction → Codestral 提供商）：

- **API URL**：仅 CCR 基址，例如 `http://127.0.0.1:3456`（Zed 会追加 `/v1/fim/completions`）。
- **API key**：必须匹配 CCR `APIKEY`（不是你的 Mistral key）。调用 Mistral 时 CCR 会替换 `$CODESTRAL_API_KEY`。
- **Model**：`codestral-latest`（或默认）；裸名经 `Router.fim` 解析。

---

## 其他提供商

### DeepSeek（`fim.deepseek`）

```json
{
  "name": "deepseek-fim",
  "api_base_url": "https://api.deepseek.com/beta/completions",
  "api_key": "$DEEPSEEK_API_KEY",
  "models": ["deepseek-chat"],
  "transformer": { "use": ["fim.deepseek"] }
}
```

## 架构说明

- 入站 kind 定义**客户端契约**（请求解析 + 响应编码）。v1 入站仅为 Codestral/Mistral。
- 流程：入站 → Unified FIM → 出站 `fim.*`。
- **同族**（`inbound === outbound`）：请求与响应 body 透传（仅鉴权/URL）。
- **跨族**：出站转换器按提供商编码请求；流水线将上游响应编码回**入站**线格式（并非永远固定 Codestral）。
- 未来的 DeepSeek 入站适配器接入同一接缝；届时客户端响应将匹配那些入站线格式。
- 配置**专用** FIM 提供商；不要将聊天转换器（`mistral`、`deepseek` 等）与 `fim.*` 叠在同一提供商上。
- 遗留客户端 `/v1/completions` 仍不路由（404）。

另见：[路由](/docs/server/config/routing)（`Router.fim`）、[提供商](/docs/server/config/providers)、[转换器](/docs/server/config/transformers)（`fim.*`）。
