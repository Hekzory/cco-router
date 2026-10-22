![](blog/images/claude-code-router-img.png)

[![](https://img.shields.io/github/license/musistudio/claude-code-router)](https://github.com/musistudio/claude-code-router/blob/main/LICENSE)

## ✨ Features

- **Model Routing**: Route requests by scenario (background, thinking, long context, web search, FIM, image).
- **Native Client Protocols**: Accept Anthropic Messages, OpenAI Chat Completions, OpenAI Responses, and FIM Completions (FIM uses a dedicated pipeline and `fim.*` transformers).
- **Multi-Provider Support**: Supports various model providers like OpenRouter, DeepSeek, Gemini, Codex, Claude subscription, and Qwen.
- **Request/Response Transformation**: Customize requests and responses for different providers using transformers.
- **Dynamic Model Switching**: Switch models on-the-fly within Claude Code using the `/model` command.
- **CLI Model Management**: Manage models and providers directly from the terminal with `ccr model`.
- **GitHub Actions Integration**: Trigger Claude Code tasks in your GitHub workflows.
- **Plugin System**: Extend functionality with custom transformers.

## 🛠 Improvements in this fork

This fork is based on [claude-code-router](https://github.com/musistudio/claude-code-router) and includes several enhancements:

- **Codex breaking change — required chaining:** Codex is no longer a converting owner. Providers **must** set `"transformer": { "use": ["openai-responses", "codex"] }`. A `codex`-only chain is rejected. `openai-responses` owns the Responses wire (including encrypted reasoning items); `codex` is ChatGPT auth/headers middleware (`store: false`, `stream: true`). Responses clients passthrough `input[]`.
- **Improved LLM Support**: Fixed streaming for Gemini/Gemma and enhanced OpenAI API handling.
- **Reasoning & Streaming Refactor**: Modularized streaming and reasoning logic into reusable utilities for better maintainability.
- **Mistral Integration**: Added specific handling for Mistral's reasoning parameters and decoupled transformation logic.
- **Build & Deployment**: Integrated the UI package into the Docker build process and added a Docker Compose configuration.
- **Code Quality**: Localized codebase (English comments), improved error handling, and addressed Copilot review feedback.
- **Gemini Stability & Tool Use Fixes**: Corrected `thoughtSignature` placement in Gemini request bodies (must be a standalone `thought: true` part, not attached to text/function-call parts); filtered synthetic `ccr_` placeholder signatures from outgoing Gemini requests to prevent Gemini 500 errors; fixed `tool_result` content-array serialization in the Anthropic transformer so models receive plain text instead of JSON-wrapped arrays (resolves "Error editing file" in Claude Code); fixed Fastify `onSend` hook to prevent `invalid type 'object'` unhandled rejections on error responses.
- **Codex (ChatGPT) Integration**: ChatGPT backend over the Responses API. **Requires** `"use": ["openai-responses", "codex"]`. Supports OAuth (`ccr codex-auth`) and PAT (`api_key: "at-..."`), SSE streaming, encrypted reasoning replay, tool calls with web search, and image handling.
- **Claude Subscription Integration**: Added `claude-auth` support for routing through a Claude Pro or Max subscription via OAuth (`ccr claude-auth`), using the `claude-auth` + `Anthropic` transformer chain.
- **Qwen Chat Integration**: Added `qwen-auth` transformer for the Qwen Chat backend (`qwen.aikit.club/v1/chat/completions`), supporting JWT-based authentication (`ccr qwen-auth`) where the user pastes a token copied from `chat.qwen.ai` localStorage, automatic token rotation, and stripping of the trailing `<details>...</details>` metadata block Qwen injects into responses.
- **DeepSeek Reasoning Replay**: Implemented mandatory reasoning replay for DeepSeek models (e.g., via OpenCode/ZenGo). DeepSeek requires previous assistant reasoning content to be included in subsequent requests — the `reasoning` transformer automatically replays reasoning output from prior turns.
- **Model Discovery**: Enabled non-interactive model discovery for arbitrary API providers. Using `ccr model get <provider>`, the tool automatically fetches remote models, parses custom JSON structures using configurable paths, and appends missing models to the local configuration while preserving existing settings.

## 🚀 Getting Started

### 1. Installation

#### Prerequisites

Before you begin, ensure you have the following installed on your system:
- **Docker & Docker Compose** (Recommended): The primary way to run the router. See [Docker Install Guide](https://docs.docker.com/get-docker/).
- **Node.js** (Optional): Required to run from source, or publish packages. This fork requires **Node.js ≥ 22.19.0** (needed by `undici`). See [Node.js Download](https://nodejs.org/).
- **Claude Code**: See the [official quickstart guide](https://code.claude.com/docs/en/quickstart) for installation instructions.

#### Quick Start with Docker

The fastest way to launch Claude Code Router is using Docker Compose:

```shell
cd packages/server
docker compose up --build -d
```

The Compose setup builds the server and UI into the `ccr` container, exposes the proxy on `http://localhost:3456`, and mounts configuration from `packages/server/ccr-config` to `/root/.claude-code-router` inside the container.

### 2. Configuration

Create and configure your `~/.claude-code-router/config.json` file. For more details, you can refer to `config.example.json`.

The `config.json` file has several key sections:

- **`PROXY_URL`** (optional): You can set a proxy for API requests, for example: `"PROXY_URL": "http://127.0.0.1:7890"`. Loopback targets (`localhost`, `127.0.0.1`, `::1`) always bypass the proxy. Hosts listed in the `NO_PROXY` / `no_proxy` environment variables also bypass it (comma-separated hosts, `.domain` / `*.domain`, CIDR, optional `:port`).
- **`LOG`** (optional): You can enable logging by setting it to `true`. When set to `false`, no log files will be created. Default is `true`.
- **`LOG_LEVEL`** (optional): Set the logging level. Available options are: `"fatal"`, `"error"`, `"warn"`, `"info"`, `"debug"`, `"trace"`. Default is `"info"`.
- **`LOG_SSE_EVENTS`** (optional): When `true`, logs every SSE event on both **provider→CCR** and **CCR→client** while `LOG_LEVEL` is `debug`. Default is `false`. Pair with `LOG_REQUEST_BODY_PARTS` for body capture on **client→CCR** and **CCR→provider**.
- **Logging Systems**: The Claude Code Router uses two separate logging systems:
  - **Server-level logs**: HTTP requests, API calls, and server events are logged using pino in the `~/.claude-code-router/logs/` directory with filenames like `ccr-*.log`
  - **Application-level logs**: Routing decisions and business logic events are logged in `~/.claude-code-router/claude-code-router.log`
- **`APIKEY`** (optional): You can set a secret key to authenticate requests. When set, clients must provide this key in the `Authorization` header (e.g., `Bearer your-secret-key`) or the `x-api-key` header. Example: `"APIKEY": "your-secret-key"`.
- **`HOST`** (optional): You can set the host address for the server. If `APIKEY` is not set, the host will be forced to `127.0.0.1` for security reasons to prevent unauthorized access. Example: `"HOST": "0.0.0.0"`.
- **`NON_INTERACTIVE_MODE`** (optional): When set to `true`, enables compatibility with non-interactive environments like GitHub Actions, Docker containers, or other CI/CD systems. This sets appropriate environment variables (`CI=true`, `FORCE_COLOR=0`, etc.) and configures stdin handling to prevent the process from hanging in automated environments. Example: `"NON_INTERACTIVE_MODE": true`.

- **`Providers`**: Used to configure different model providers.
- **`Router`**: Used to set up routing rules. `default` specifies the default model, which will be used for all requests if no other route is configured.
- **`API_TIMEOUT_MS`**: Specifies the timeout for API calls in milliseconds.

#### Environment Variable Interpolation

Claude Code Router supports environment variable interpolation for secure API key management. You can reference environment variables in your `config.json` using either `$VAR_NAME` or `${VAR_NAME}` syntax:

```json
{
  "OPENAI_API_KEY": "$OPENAI_API_KEY",
  "GEMINI_API_KEY": "${GEMINI_API_KEY}",
  "Providers": [
    {
      "name": "openai",
      "api_base_url": "https://api.openai.com/v1/chat/completions",
      "api_key": "$OPENAI_API_KEY",
      "models": ["gpt-5", "gpt-5-mini"]
    }
  ]
}
```

This allows you to keep sensitive API keys in environment variables instead of hardcoding them in configuration files. The interpolation works recursively through nested objects and arrays.

Here is a comprehensive example:

```json
{
  "APIKEY": "your-secret-key",
  "PROXY_URL": "http://127.0.0.1:7890",
  "LOG": true,
  "API_TIMEOUT_MS": 600000,
  "NON_INTERACTIVE_MODE": false,
  "Providers": [
    {
      "name": "openrouter",
      "api_base_url": "https://openrouter.ai/api/v1/chat/completions",
      "api_key": "sk-xxx",
      "models": [
        "google/gemini-2.5-pro-preview",
        "anthropic/claude-sonnet-4",
        "anthropic/claude-3.5-sonnet",
        "anthropic/claude-3.7-sonnet:thinking"
      ],
      "transformer": {
        "use": ["openrouter"]
      }
    },
    {
      "name": "deepseek",
      "api_base_url": "https://api.deepseek.com/chat/completions",
      "api_key": "sk-xxx",
      "models": ["deepseek-chat", "deepseek-reasoner"],
      "transformer": {
        "use": ["deepseek"],
        "deepseek-chat": {
          "use": ["tooluse"]
        }
      }
    },
    {
      "name": "gemini",
      "api_base_url": "https://generativelanguage.googleapis.com/v1beta/models/",
      "api_key": "sk-xxx",
      "models": ["gemini-2.5-flash", "gemini-2.5-pro", "gemma-4-31b-it"],
      "transformer": {
        "use": ["gemini"]
      }
    },
    {
      "name": "modelscope",
      "api_base_url": "https://api-inference.modelscope.cn/v1/chat/completions",
      "api_key": "",
      "models": ["Qwen/Qwen3-Coder-480B-A35B-Instruct", "Qwen/Qwen3-235B-A22B-Thinking-2507"],
      "transformer": {
        "use": [
          [
            "maxtoken",
            {
              "max_tokens": 65536
            }
          ],
          "enhancetool"
        ],
        "Qwen/Qwen3-235B-A22B-Thinking-2507": {
          "use": ["reasoning"]
        }
      }
    },
    {
      "name": "dashscope",
      "api_base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
      "api_key": "",
      "models": ["qwen3-coder-plus"],
      "transformer": {
        "use": [
          [
            "maxtoken",
            {
              "max_tokens": 65536
            }
          ],
          "enhancetool"
        ]
      }
    },
    {
      "name": "aihubmix",
      "api_base_url": "https://aihubmix.com/v1/chat/completions",
      "api_key": "sk-",
      "models": [
        "glm-4.5",
        "claude-opus-4-20250514",
        "gemini-2.5-pro"
      ]
    }
  ],
  "Router": {
    "default": "deepseek,deepseek-chat",
    "background": "gemini,gemini-2.5-flash",
    "think": "deepseek,deepseek-reasoner",
    "longContext": "openrouter,google/gemini-2.5-pro-preview",
    "longContextThreshold": 60000,
    "webSearch": "gemini,gemini-2.5-flash"
  }
}
```

#### Adding a New Provider

If you want to add a new provider and automatically discover its models, follow these steps:

1. **Add Minimal Config**: Add a new entry to the `Providers` array in `config.json` with just the basic details:
   ```json
   {
     "name": "my-new-provider",
     "api_base_url": "https://api.example.com/v1/chat/completions",
     "api_key": "$MY_API_KEY",
     "models": []
   }
   ```
2. **Perform Model Discovery**: Run the discovery command to fetch available models:
   ```shell
   ccr model get my-new-provider
   ```
3. **Sync Models**: The command will list remote models and prompt you to append missing ones to your configuration.
4. **Restart**: Restart the service to pick up the updated configuration:
   ```shell
   ccr restart
   ```

> **Tip**: For a more comprehensive description of model discovery options, custom JSON response formats, and interactive model management, see the [CLI Model Management](#5-cli-model-management) section.

### 3. Running Claude Code with the Router

#### Via `ccr code`

Start Claude Code using the router:

```shell
ccr code
```

#### Via Claude Code Settings (Alternative)

You can also configure Claude Code to always use the router by editing its `settings.json` file (typically at `~/.claude/settings.json`). Models are specified using the `<provider>,<model>` syntax:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:3456",
    "ANTHROPIC_AUTH_TOKEN": "dummy",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "gemini,gemma-4-31b-it",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "opencode,minimax-m2.7",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "opencode,glm-5.1"
  }
}
```

| Variable | Purpose |
|---|---|
| `ANTHROPIC_BASE_URL` | Points Claude Code to the router's proxy address |
| `ANTHROPIC_AUTH_TOKEN` | Must match the `APIKEY` value set in the router's `config.json` |
| `ANTHROPIC_MODEL` | Default model (overrides per-tier defaults below) |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | Fast / cost-effective model (Haiku equivalent) |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | Balanced performance model (Sonnet equivalent) |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | Maximum capability model (Opus equivalent) |

This approach lets you run `claude` directly without needing `ccr code`.

> **Note**: After modifying the configuration file, you need to restart the service for the changes to take effect:
>
> ```shell
> ccr restart
> ```

### 4. UI Mode

For a more intuitive experience, you can use the UI mode to manage your configuration:

```shell
ccr ui
```

This will open a web-based interface where you can easily view and edit your `config.json` file.

![UI](/blog/images/ui.png)

### 5. CLI Model Management

For users who prefer terminal-based workflows, you can use the interactive CLI model selector:

```shell
ccr model
```
![](blog/images/models.gif)

This command provides an interactive interface to:

- View current configuration:
- See all configured models (default, background, think, longContext, webSearch, image)
- Switch models: Quickly change which model is used for each router type
- Add new models: Add models to existing providers
- Create new providers: Set up complete provider configurations including:
   - Provider name and API endpoint
   - API key
   - Available models
   - Transformer configuration with support for:
     - Multiple transformers (openrouter, deepseek, gemini, etc.)
     - Transformer options (e.g., maxtoken with custom limits)
     - Provider-specific routing (e.g., OpenRouter provider preferences)

The CLI tool validates all inputs and provides helpful prompts to guide you through the configuration process, making it easy to manage complex setups without editing JSON files manually.

For non-interactive model discovery, you can also test provider access and list remote models directly:

```shell
ccr model get openai
ccr model get gemini
```

This command:
- Calls the provider's model-list endpoint using the configured API key
- Prints the remote models returned by the provider
- Prompts to append only missing models to the configured `models` array

Built-in endpoint support is included for `openai` and `gemini`. For other providers, you can configure `models_api_url` and a custom `models_response_format` to handle different JSON response structures.

The `models_response_format` object supports:
- `listPath`: JSON path to the array of models (e.g., `"data"`, `"models"`, or `""` for root array)
- `idPath`: Field name within each model object to use as ID (e.g., `"id"`, `"name"`, `"slug"`)
- `stripPrefix`: Optional prefix to remove from model IDs (e.g., `"models/"`)

Example:

```json
{
  "name": "together.ai",
  "api_base_url": "https://api.together.ai/v1/chat/completions",
  "models_api_url": "https://api.together.ai/v1/models",
  "api_key": "$TOGETHERAI_API_KEY",
  "models": [],
  "models_response_format": {
    "listPath": "",
    "idPath": "id"
  }
}
```

You can also override these settings via CLI flags for testing:
```shell
ccr model get my-provider --list-path data --id-path id --strip-prefix "v1/"
```

If the provider returns additional models, `ccr model get <provider>` can append only the missing entries while keeping existing configured models unchanged.

> **Note**: After syncing models into `config.json`, restart the service with `ccr restart` so the updated provider list is picked up by the running server.

#### Codex Provider Authentication

The Codex provider supports two authentication modes:

- **OAuth** via `ccr codex-auth`
- **PAT** via `api_key: "at-..."`

##### OAuth mode

Before using Codex models with OAuth, authenticate with your OpenAI account:

```shell
ccr codex-auth
```

This command:
1. Opens your browser to the OpenAI OAuth authorization page
2. After you sign in, the OAuth callback is handled by the running CCR server
3. Tokens are stored in `~/.claude-code-router/codex_auth.json`
4. The Codex transformer automatically refreshes tokens when they expire

> **Note**: The server must be running for `ccr codex-auth` to work, as it hosts the OAuth callback endpoint.

**Running with Docker**:

The OAuth callback uses port `1455`, which is mapped to the CCR server port in `docker-compose.yml` (`"1455:3456"`). When running in Docker:

```shell
docker exec -it claude-code-router ccr codex-auth
```

The CLI prints a URL to open in your host browser. After signing in, the browser redirects to `http://localhost:1455/auth/callback`, which Docker forwards to the container. Tokens persist across container restarts via the volume-mounted `./ccr-config` directory.

##### PAT mode

If your provider `api_key` starts with `at-`, CCR treats it as a Codex Personal Access Token and uses it directly. In PAT mode, you do **not** run `ccr codex-auth`.

```json
{
  "name": "codex",
  "api_base_url": "https://chatgpt.com/backend-api/codex",
  "api_key": "at-your-personal-access-token",
  "models": ["gpt-5.4"],
  "transformer": {
    "use": ["openai-responses", "codex"]
  }
}
```

On the first request, CCR resolves the required account headers from OpenAI and caches the result in memory. If `api_key` is not a PAT, CCR falls back to OAuth tokens from `~/.claude-code-router/codex_auth.json`.

> **See also**: Full Codex setup and troubleshooting are documented in `docs/docs/server/guides/codex.md`.

#### Claude Subscription Authentication

The Claude subscription provider uses OAuth to authenticate with Anthropic's API using your Claude Pro or Max subscription. Before using Claude models this way, you must authenticate:

```shell
ccr claude-auth
```

This command:
1. Opens your browser to the Claude OAuth authorization page
2. After you sign in, the OAuth callback is handled by the running CCR server on port `1455`
3. Tokens are stored in `~/.claude-code-router/claude_auth.json`
4. The `claude-auth` transformer automatically refreshes tokens when they expire

> **Note**: The server must be running for `ccr claude-auth` to work, as it hosts the OAuth callback endpoint on port 1455.

**Running with Docker**:

The OAuth callback uses port `1455`, which is mapped to the CCR server port in `docker-compose.yml` (`"1455:3456"`). When running in Docker:

```shell
docker exec -it claude-code-router ccr claude-auth
```

The CLI prints a URL to open in your host browser. After signing in, the browser redirects to `http://localhost:1455/callback`, which Docker forwards to the container. Tokens persist across container restarts via the volume-mounted `./ccr-config` directory.

A Claude subscription provider requires the `claude-auth` + `Anthropic` transformer chain:

```json
{
  "name": "claude-subscription",
  "api_base_url": "https://api.anthropic.com",
  "api_key": "no-key",
  "models": ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5"],
  "transformer": {
    "use": ["claude-auth", "Anthropic"]
  }
}
```

> **See also**: Full Claude subscription setup is documented in `docs/docs/server/guides/claude-auth.md`.

**Custom Transformers:**

#### Qwen Provider Authentication

The Qwen provider uses a single JWT to authenticate with the Qwen Chat backend. Before using Qwen models, you must save a token to your local CCR config:

```shell
ccr qwen-auth
```

This command:
1. Prints a URL (`http://127.0.0.1:<port>/qwen/auth`) for the in-browser auth page
2. The page offers two options:
   - **Bookmarklet (recommended)**: drag the "Get Qwen Token" link to your bookmarks bar, then click it on the signed-in Qwen page. The token is sent back to CCR automatically.
   - **Manual paste**: sign in at `chat.qwen.ai`, open dev tools (F12) → Console, run `copy(localStorage.getItem('token'))`, paste the JWT into the form and submit.
3. The token is validated against `qwen.aikit.club/v1/validate` and saved to `~/.claude-code-router/qwen_auth.json` (mode 0600)
4. The `qwen-auth` transformer automatically refreshes the token when it nears expiry (within 6 hours)

> **Note**: The server must be running for `ccr qwen-auth` to work, as it hosts the auth form at `/qwen/auth`. Unlike the Codex flow, no OAuth callback is required — the token is pasted directly into the form.

**Running with Docker**:

The Qwen auth page is served on the regular CCR port (no separate callback port). When running in Docker:

```shell
docker exec -it claude-code-router ccr qwen-auth
```

The CLI prints a URL to open in your host browser (`http://localhost:3456/qwen/auth`, which Docker forwards to the container). Tokens persist across container restarts via the volume-mounted `./ccr-config` directory.

**Custom host/port for the bookmarklet**: The bookmarklet's redirect target is hardcoded into the JS because it runs in the Qwen page's context (with no knowledge of CCR's address). By default it points to `http://127.0.0.1:3456`. If your CCR server is on a different host or port, set the `QWEN_AUTH_REDIRECT` env var before starting the server, e.g. `QWEN_AUTH_REDIRECT=http://192.168.1.10:8080` — the bookmarklet will then redirect to that address.

### 6. Presets Management

Presets allow you to save, share, and reuse configurations easily. You can export your current configuration as a preset and install presets from files or URLs.

```shell
# Export current configuration as a preset
ccr preset export my-preset

# Export with metadata
ccr preset export my-preset --description "My OpenAI config" --author "Your Name" --tags "openai,production"

# Install a preset from local directory
ccr preset install /path/to/preset

# List all installed presets
ccr preset list

# Show preset information
ccr preset info my-preset

# Delete a preset
ccr preset delete my-preset
```

**Preset Features:**
- **Export**: Save your current configuration as a preset directory (with manifest.json)
- **Install**: Install presets from local directories
- **Sensitive Data Handling**: API keys and other sensitive data are automatically sanitized during export (marked as `{{field}}` placeholders)
- **Dynamic Configuration**: Presets can include input schemas for collecting required information during installation
- **Version Control**: Each preset includes version metadata for tracking updates

**Preset File Structure:**
```
~/.claude-code-router/presets/
├── my-preset/
│   └── manifest.json    # Contains configuration and metadata
```

### 7. Activate Command (Environment Variables Setup)

The `activate` command allows you to set up environment variables globally in your shell, enabling you to use the `claude` command directly or integrate Claude Code Router with applications built using the Agent SDK.

To activate the environment variables, run:

```shell
eval "$(ccr activate)"
```

This command outputs the necessary environment variables in shell-friendly format, which are then set in your current shell session. After activation, you can:

- **Use `claude` command directly**: Run `claude` commands without needing to use `ccr code`. The `claude` command will automatically route requests through Claude Code Router.
- **Integrate with Agent SDK applications**: Applications built with the Anthropic Agent SDK will automatically use the configured router and models.

The `activate` command sets the following environment variables:

- `ANTHROPIC_AUTH_TOKEN`: API key from your configuration
- `ANTHROPIC_BASE_URL`: The local router endpoint (default: `http://127.0.0.1:3456`)
- `NO_PROXY`: Set to `127.0.0.1` to prevent proxy interference
- `DISABLE_TELEMETRY`: Disables telemetry
- `DISABLE_COST_WARNINGS`: Disables cost warnings
- `API_TIMEOUT_MS`: API timeout from your configuration

> **Note**: Make sure the Claude Code Router service is running (`ccr start`) before using the activated environment variables. The environment variables are only valid for the current shell session. To make them persistent, you can add `eval "$(ccr activate)"` to your shell configuration file (e.g., `~/.zshrc` or `~/.bashrc`).

#### Providers

The `Providers` array is where you define the different model providers you want to use. Each provider object requires:

- `name`: A unique name for the provider.
- `api_base_url`: The full API endpoint for chat completions.
- `api_key`: Your API key for the provider.
- `models`: A list of model names available from this provider.
- `transformer` (optional): Specifies transformers to process requests and responses.

#### Transformers

Transformers allow you to modify the request and response payloads to ensure compatibility with different provider APIs.

- **Global Transformer**: Apply a transformer to all models from a provider. In this example, the `openrouter` transformer is applied to all models under the `openrouter` provider.
  ```json
  {
    "name": "openrouter",
    "api_base_url": "https://openrouter.ai/api/v1/chat/completions",
    "api_key": "sk-xxx",
    "models": [
      "google/gemini-2.5-pro-preview",
      "anthropic/claude-sonnet-4",
      "anthropic/claude-3.5-sonnet"
    ],
    "transformer": { "use": ["openrouter"] }
  }
  ```
- **Model-Specific Transformer**: Apply a transformer to a specific model. In this example, the `deepseek` transformer is applied to all models, and an additional `tooluse` transformer is applied only to the `deepseek-chat` model.

  ```json
  {
    "name": "deepseek",
    "api_base_url": "https://api.deepseek.com/chat/completions",
    "api_key": "sk-xxx",
    "models": ["deepseek-chat", "deepseek-reasoner"],
    "transformer": {
      "use": ["deepseek"],
      "deepseek-chat": { "use": ["tooluse"] }
    }
  }
  ```

- **Passing Options to a Transformer**: Some transformers, like `maxtoken`, accept options. To pass options, use a nested array where the first element is the transformer name and the second is an options object.
  ```json
  {
    "name": "example",
    "api_base_url": "https://api.example.com/v1/chat/completions",
    "api_key": "your-api-key",
    "models": ["example-model"],
    "transformer": {
      "use": [
        [
          "maxtoken",
          {
            "max_tokens": 16384
          }
        ]
      ]
    }
  }
  ```

**Available Built-in Transformers:**

- Protocol owners: `Anthropic` (`/v1/messages`), `OpenAI` (`/v1/chat/completions`), `openai-responses` (`/v1/responses`), `Fim` (`/v1/fim/completions`).
- FIM provider adapters: `fim.mistral`, `fim.deepseek`, `fim.qwen` (dedicated FIM providers only — do not stack with chat transformers).
- `Anthropic`: When used as provider egress / same-protocol keep, can preserve Anthropic wire; also converts Unified ↔ Anthropic for cross-protocol clients.
- `deepseek`: Adapts requests/responses for DeepSeek API.
- `gemini`: Adapts requests/responses for Gemini API.
- `mistral`: Adapts requests/responses for Mistral API.
- `openrouter`: Adapts requests/responses for OpenRouter API. It can also accept a `provider` routing parameter to specify which underlying providers OpenRouter should use. For more details, refer to the [OpenRouter documentation](https://openrouter.ai/docs/features/provider-routing). See an example below:
  ```json
    "transformer": {
      "use": ["openrouter"],
      "moonshotai/kimi-k2": {
        "use": [
          [
            "openrouter",
            {
              "provider": {
                "only": ["moonshotai/fp8"]
              }
            }
          ]
        ]
      }
    }
  ```
- `groq`: Adapts requests/responses for groq API.
- `maxtoken`: Sets a specific `max_tokens` value.
- `tooluse`: Optimizes tool usage for certain models via `tool_choice`.
- `gemini-cli` (experimental): Unofficial support for Gemini via Gemini CLI [gemini-cli.js](https://gist.github.com/musistudio/1c13a65f35916a7ab690649d3df8d1cd).
- `reasoning`: Used to process the `reasoning_content` field.
- `sampling`: Used to process sampling information fields such as `temperature`, `top_p`, `top_k`, and `repetition_penalty`.
- `enhancetool`: Adds a layer of error tolerance to the tool call parameters returned by the LLM (this will cause the tool call information to no longer be streamed).
- `cleancache`: Clears the `cache_control` field from requests.
- `vertex-gemini`: Handles the Gemini API using Vertex authentication.
- `chutes-glm` Unofficial support for GLM 4.5 model via Chutes [chutes-glm-transformer.js](https://gist.github.com/vitobotta/2be3f33722e05e8d4f9d2b0138b8c863).
- `qwen-cli` (experimental): Unofficial support for qwen3-coder-plus model via Qwen CLI [qwen-cli.js](https://gist.github.com/musistudio/f5a67841ced39912fd99e42200d5ca8b).
- `rovo-cli` (experimental): Unofficial support for gpt-5 via Atlassian Rovo Dev CLI [rovo-cli.js](https://gist.github.com/SaseQ/c2a20a38b11276537ec5332d1f7a5e53).
- `codex`: Adapts requests/responses for the Codex (ChatGPT) backend API. Supports OAuth via `ccr codex-auth` or PAT auth when `api_key` starts with `at-`.
- `claude-auth`: Authenticates requests to Anthropic's API using your Claude Pro or Max subscription OAuth token. Converts Unified format to Anthropic format and handles SSE response conversion. Use it together with `Anthropic` in the provider chain, and authenticate via `ccr claude-auth`.

**Codex Provider Configuration:**

The Codex transformer connects to the ChatGPT backend API, providing access to GPT-5.x models. It supports either OAuth authentication or a PAT in `api_key`.

```json
{
  "name": "codex",
  "api_base_url": "https://chatgpt.com/backend-api/codex",
  "api_key": "oauth_dummy_key",
  "models": ["gpt-5.4"],
  "transformer": {
    "use": ["openai-responses", "codex"]
  }
}
```

> **OAuth mode**: Keep `api_key` as a placeholder and run `ccr codex-auth`. OAuth tokens are stored in `~/.claude-code-router/codex_auth.json`.

```json
{
  "name": "codex",
  "api_base_url": "https://chatgpt.com/backend-api/codex",
  "api_key": "at-your-personal-access-token",
  "models": ["gpt-5.4"],
  "transformer": {
    "use": ["openai-responses", "codex"]
  }
}
```

> **PAT mode**: If `api_key` starts with `at-`, CCR uses it directly and skips `ccr codex-auth`.

> **Note**: If `api_key` is not a PAT, CCR falls back to OAuth tokens from `~/.claude-code-router/codex_auth.json`.

**Qwen Provider Configuration:**

The Qwen provider uses the `qwen-auth` transformer (for the `Authorization: Bearer <jwt>` header and trailing `<details>` strip) paired with the existing `OpenAI` transformer (which registers the `POST /v1/chat/completions` endpoint).

```json
{
  "name": "qwen",
  "api_base_url": "https://qwen.aikit.club/v1/chat/completions",
  "api_key": "qwen-placeholder",
  "models": ["qwen3-max", "qwen3-coder-plus"],
  "transformer": {
    "use": ["qwen-auth", "reasoning", "OpenAI"]
  }
}
```

Three transformers are required in the chain:

- `qwen-auth` — sets the `Authorization: Bearer <jwt>` header on every outbound request (loading/refreshing the JWT from `~/.claude-code-router/qwen_auth.json`) and strips the trailing `<details>...</details>` block Qwen injects into responses.
- `reasoning` — maps Claude Code's unified `reasoning` field onto the request so the Qwen endpoint's `enable_thinking` and `thinking_budget` parameters are populated.
- `OpenAI` — protocol owner for `POST /v1/chat/completions` (validates inbound Chat bodies; applies provider-side cache policy). Keep it last in Qwen-style chains that already set auth/reasoning.

> **Note**: The `api_key` field is a placeholder — actual authentication is handled via the JWT stored in `~/.claude-code-router/qwen_auth.json`. Run `ccr qwen-auth` to authenticate before using the Qwen provider.

**Claude Subscription Provider Configuration:**

The `claude-auth` transformer routes requests to Anthropic's API using your Claude Pro or Max subscription OAuth token instead of a static API key.

```json
{
  "name": "claude-subscription",
  "api_base_url": "https://api.anthropic.com",
  "api_key": "no-key",
  "models": ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5"],
  "transformer": {
    "use": ["claude-auth", "Anthropic"]
  }
}
```

Two transformers are required in the chain:

- `claude-auth` — converts the request from Unified (OpenAI) format to Anthropic format, injects `Authorization: Bearer <token>` (loading/refreshing the token from `~/.claude-code-router/claude_auth.json`), and converts the Anthropic SSE response back to Unified format.
- `Anthropic` — registers the `POST /v1/messages` route. It has no body conversion in the provider chain, so it acts as a no-op endpoint stub.

> **Note**: The `api_key` field is a placeholder — actual authentication is handled via OAuth tokens stored in `~/.claude-code-router/claude_auth.json`. Run `ccr claude-auth` to authenticate before using this provider. The transformer automatically sends Anthropic's `oauth-2025-04-20` beta so subscription OAuth Bearer tokens are accepted.

**DeepSeek via OpenCode (Mandatory Reasoning Replay):**

DeepSeek models require previous assistant reasoning content to be replayed in subsequent requests. When using DeepSeek models through providers like OpenCode, apply the `reasoning` transformer at the model level to handle this automatically:

```json
{
  "name": "opencode",
  "api_base_url": "https://opencode.ai/zen/go/v1/chat/completions",
  "api_key": "$OPENCODE_API_KEY",
  "models": ["deepseek-v4-pro", "deepseek-v4-flash"],
  "transformer": {
    "use": ["OpenAI", "opencode-headers"],
    "deepseek-v4-pro": {
      "use": ["reasoning"]
    },
    "deepseek-v4-flash": {
      "use": ["reasoning"]
    }
  }
}
```

> **Note**: `opencode-headers` mirrors the OpenCode client identity headers and owns bounded Zen retries while preserving session affinity. Keep it provider-wide. Apply `reasoning` specifically to DeepSeek models (not provider-wide) so previous assistant reasoning is replayed as required by the DeepSeek API.

**Custom Transformers:**

You can also create your own transformers and load them via the `transformers` field in `config.json`.

```json
{
  "transformers": [
    {
      "path": "/User/xxx/.claude-code-router/plugins/gemini-cli.js",
      "options": {
        "project": "xxx"
      }
    }
  ]
}
```

#### Router

The `Router` object defines which model to use for different scenarios:

- `default`: The default model for general tasks.
- `background`: A model for background tasks. This can be a smaller, local model to save costs.
- `think`: A model for reasoning-heavy tasks, like Plan Mode.
- `longContext`: A model for handling long contexts (e.g., > 60K tokens).
- `longContextThreshold` (optional): The token count threshold for triggering the long context model. Defaults to 60000 if not specified.
- `webSearch`: Used for handling web search tasks and this requires the model itself to support the feature. If you're using openrouter, you need to add the `:online` suffix after the model name.
- `fim`: Used for `POST /v1/fim/completions` (fill-in-the-middle). Destination provider must use a `fim.*` transformer (`fim.mistral`, `fim.deepseek`, or `fim.qwen`). See `docs/docs/server/api/fim-completions-api.md`.
- `image` (beta): Used for handling image-related tasks (supported by CCR’s built-in agent). If the model does not support tool calling, you need to set the `config.forceUseImageAgent` property to `true`.

- You can also switch models dynamically in Claude Code with the `/model` command:
`/model provider_name,model_name`
Example: `/model openrouter,anthropic/claude-3.5-sonnet`

#### Custom Router

For more advanced routing logic, you can specify a custom router script via the `CUSTOM_ROUTER_PATH` in your `config.json`. This allows you to implement complex routing rules beyond the default scenarios.

In your `config.json`:

```json
{
  "CUSTOM_ROUTER_PATH": "/User/xxx/.claude-code-router/custom-router.js"
}
```

The custom router file must be a JavaScript module that exports an `async` function. This function receives the request object and the config object as arguments and should return the provider and model name as a string (e.g., `"provider_name,model_name"`), or `null` to fall back to the default router.

Here is an example of a `custom-router.js` based on `custom-router.example.js`:

```javascript
// /User/xxx/.claude-code-router/custom-router.js

/**
 * A custom router function to determine which model to use based on the request.
 *
 * @param {object} req - The request object from Claude Code, containing the request body.
 * @param {object} config - The application's config object.
 * @returns {Promise<string|null>} - A promise that resolves to the "provider,model_name" string, or null to use the default router.
 */
module.exports = async function router(req, config) {
  const userMessage = req.body.messages.find((m) => m.role === "user")?.content;

  if (userMessage && userMessage.includes("explain this code")) {
    // Use a powerful model for code explanation
    return "openrouter,anthropic/claude-3.5-sonnet";
  }

  // Fallback to the default router configuration
  return null;
};
```

##### Subagent Routing

Claude Code subagent requests can be routed with:

1. An explicit `<CCR-SUBAGENT-MODEL>provider,model</CCR-SUBAGENT-MODEL>` tag in system or message text (the tag is stripped before the upstream request). `provider/model` is also accepted.
2. Or the `CLAUDE_CODE_SUBAGENT_MODEL=provider,model` environment variable when Claude Code marks the turn as a subagent.

Tag takes priority over the environment variable. If neither is set, normal Router rules apply.

**Example:**

```
<CCR-SUBAGENT-MODEL>openrouter,anthropic/claude-3.5-sonnet</CCR-SUBAGENT-MODEL>
Please help me analyze this code snippet for potential optimizations...
```

```bash
export CLAUDE_CODE_SUBAGENT_MODEL="openrouter,anthropic/claude-3.5-sonnet"
```

## Status Line (Beta)
To better monitor the status of claude-code-router at runtime, version v1.0.40 includes a built-in statusline tool, which you can enable in the UI.
![statusline-config.png](/blog/images/statusline-config.png)

The effect is as follows:
![statusline](/blog/images/statusline.png)

## 🤖 GitHub Actions

Integrate Claude Code Router into your CI/CD pipeline. After setting up [Claude Code Actions](https://docs.anthropic.com/en/docs/claude-code/github-actions), modify your `.github/workflows/claude.yaml` to use the router:

```yaml
name: Claude Code

on:
  issue_comment:
    types: [created]
  # ... other triggers

jobs:
  claude:
    if: |
      (github.event_name == 'issue_comment' && contains(github.event.comment.body, '@claude')) ||
      # ... other conditions
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: read
      issues: read
      id-token: write
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 1

      - name: Prepare Environment
        run: |
          curl -fsSL https://bun.sh/install | bash
          mkdir -p $HOME/.claude-code-router
          cat << 'EOF' > $HOME/.claude-code-router/config.json
          {
            "log": true,
            "NON_INTERACTIVE_MODE": true,
            "OPENAI_API_KEY": "${{ secrets.OPENAI_API_KEY }}",
            "OPENAI_BASE_URL": "https://api.deepseek.com",
            "OPENAI_MODEL": "deepseek-chat"
          }
          EOF
        shell: bash

      - name: Start Claude Code Router
        run: |
          nohup ~/.bun/bin/bunx @caeliq/claude-code-router@1.0.8 start &
        shell: bash

      - name: Run Claude Code
        id: claude
        uses: anthropics/claude-code-action@beta
        env:
          ANTHROPIC_BASE_URL: http://localhost:3456
        with:
          anthropic_api_key: "any-string-is-ok"
```

> **Note**: When running in GitHub Actions or other automation environments, make sure to set `"NON_INTERACTIVE_MODE": true` in your configuration to prevent the process from hanging due to stdin handling issues.

This setup allows for interesting automations, like running tasks during off-peak hours to reduce API costs.

## 📝 Further Reading

- [Codex API](https://developers.openai.com/codex/sdk) — Developer docs for the ChatGPT backend API used by the `codex` transformer (OAuth PKCE, Responses API, streaming, tool calls)
- [Provider Integration Lessons](tasks/lessons.md) — Hard-won knowledge for LLM provider integrations (DeepSeek, Mistral, Gemini, Codex)