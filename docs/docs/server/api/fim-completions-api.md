---
title: FIM Completions API
---

# FIM Completions API

First-class inbound FIM Completions protocol (`openai_fim_completions`). Owner
transformer: `Fim`. **Separate pipeline** from chat `/v1/messages`,
`/v1/chat/completions`, and `/v1/responses`.

Typical clients (for example [Zed](https://zed.dev) Edit Prediction with the Codestral provider) speak **Codestral’s** request/response wire. CCR keeps that client contract and can route upstream to Codestral itself or DeepSeek.

## Endpoint

| Path | Method |
|------|--------|
| `/v1/fim/completions` | POST |
| `/fim/completions` | POST (alias) |

## Client request (v1)

Codestral/Mistral-shaped only — `prompt` + optional `suffix`. No inbound template autodetection.

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

Bare `model` values are resolved with `Router.fim` (then `Router.default`). Prefer explicit `provider,model`.

## Client response (v1)

Response wire matches **inbound** kind. v1 inbound is Codestral/Mistral, so the client receives Codestral-shaped JSON — including when upstream is DeepSeek (cross-family encode). Same-kind Codestral→Codestral is response passthrough (no reshape).

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

| Path | Request | Response |
|------|---------|----------|
| Codestral (`fim.mistral`) | Same-kind body passthrough | Same-kind passthrough (upstream Codestral wire unchanged) |

Streaming SSE is encoded the same way (inbound kind). Clients such as Zed currently call FIM with `"stream": false`.

When DeepSeek **inbound** is added later, the client response will follow that inbound wire instead — not Codestral.

---

## Setup: Codestral

Use this when the editor talks Codestral FIM and you want CCR to proxy Mistral’s API (auth rewrite, routing, optional fallbacks).

### 1. Provider

Dedicated FIM entry — do **not** stack chat `mistral` on the same provider:

```json
{
  "name": "codestral-fim",
  "api_base_url": "https://codestral.mistral.ai/v1/fim/completions",
  "api_key": "$CODESTRAL_API_KEY",
  "models": ["codestral-latest"],
  "transformer": { "use": ["fim.mistral"] }
}
```

`fim.mistral` only sets URL + `Authorization: Bearer …`. The JSON body is passed through unchanged (same-kind passthrough).

### 2. Router

```json
"Router": {
  "fim": "codestral-fim,codestral-latest"
}
```

### 3. Point the client at CCR

Example (Zed Edit Prediction → Codestral provider):

- **API URL**: CCR base only, e.g. `http://127.0.0.1:3456` (Zed appends `/v1/fim/completions`).
- **API key**: must match CCR `APIKEY` (not your Mistral key). CCR substitutes `$CODESTRAL_API_KEY` when calling Mistral.
- **Model**: `codestral-latest` (or leave default); bare names resolve via `Router.fim`.

---

## Other providers

### DeepSeek (`fim.deepseek`)

```json
{
  "name": "deepseek-fim",
  "api_base_url": "https://api.deepseek.com/beta/completions",
  "api_key": "$DEEPSEEK_API_KEY",
  "models": ["deepseek-chat"],
  "transformer": { "use": ["fim.deepseek"] }
}
```

## Architecture notes

- Inbound kind defines the **client contract** (request parse + response encode). v1 inbound is Codestral/Mistral only.
- Flow: inbound → Unified FIM → outbound `fim.*`.
- **Same-kind** (`inbound === outbound` family): request and response body passthrough (auth/URL only).
- **Cross-family**: outbound transformer encodes the request for the provider; the pipeline encodes the upstream response back to the **inbound** wire (not a fixed Codestral shape forever).
- Future DeepSeek inbound adapters plug into the same seam; client responses will then match those inbound wires.
- Configure a **dedicated** FIM provider; do not stack chat transformers (`mistral`, `deepseek`, …) with `fim.*`.
- Legacy client `/v1/completions` remains unrouted (404).

See also: [Routing](../config/routing.md) (`Router.fim`), [Providers](../config/providers.md), [Transformers](../config/transformers.md) (`fim.*`).
