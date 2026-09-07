# pi-cc-switch-provider

[English](#english) | [中文](#中文)

---

## English

Pi extension that reads the active cc-switch output files and registers Pi providers for Codex and Claude.

### Requirements

- Node.js 22.19+
- Pi installed globally
- cc-switch installed and configured on the same Windows user account

Install Pi:

```powershell
npm install -g @earendil-works/pi-coding-agent
```

### Install

| Command | Purpose |
|---|---|
| `pi install git:github.com/Ginkgoooo/pi-cc-switch-provider` | Install this extension from GitHub. |

```powershell
pi install git:github.com/Ginkgoooo/pi-cc-switch-provider
```

### cc-switch Provider Commands

| Command | Purpose |
|---|---|
| `pi --list-models cc-switch` | List all models registered by this extension. |
| `pi` | Start Pi directly. After startup, use `/model` to select a cc-switch model. |
| `pi --provider cc-switch-codex --model current` | Start Pi with the Codex provider and follow the current model selected in cc-switch. |
| `pi --provider cc-switch-claude --model current` | Start Pi with the Claude provider and follow the current model selected in cc-switch. |
| `pi --provider cc-switch-claude --model mimo-v2.5-pro` | Start Pi with a concrete Claude model imported from cc-switch. Replace it with the one shown by `pi --list-models cc-switch`. |
| `/cc-switch` | Show the active routing mode and imported Codex/Claude provider status. |
| `/cc-switch live` | Follow the current cc-switch route, credential, model, and reasoning settings on every request. |
| `/cc-switch fixed` | Freeze Codex and Claude to the configuration snapshot captured during extension reload. |
| `/cc-switch toggle` | Toggle between live and fixed routing, then reload the extension automatically. |
| `/model` | Pi built-in command for selecting or switching models inside Pi. |

Examples:

```powershell
pi --list-models cc-switch
pi
pi --provider cc-switch-codex --model current
pi --provider cc-switch-claude --model current
pi --provider cc-switch-claude --model mimo-v2.5-pro
```

Inside Pi:

```text
/cc-switch
/cc-switch fixed
/cc-switch live
/model
```

### Routing Modes

Routing defaults to `live` to preserve the existing behavior. In this mode every Codex Responses and Claude request reads the current cc-switch output files and uses one coherent set of route, credential, model, reasoning, and authentication settings.

`fixed` captures the complete Codex and Claude configuration when the extension loads. Later cc-switch changes do not affect requests, the footer, status output, or keepwarm routing until Pi restarts or `/reload` runs. `/cc-switch live`, `/cc-switch fixed`, and `/cc-switch toggle` persist only `routingMode` in `%USERPROFILE%\.pi\agent\cc-switch-provider.json` and automatically reload the extension; API keys remain in memory and are never copied into that file. Existing `codexSummary` and unknown extension fields are preserved.

### Pi Built-in CLI Commands

General syntax:

| Command | Purpose |
|---|---|
| `pi [options] [@files...] [messages...]` | Start Pi with optional flags, file references, and an initial prompt. |

Package commands:

| Command | Purpose |
|---|---|
| `pi install <source> [-l]` | Install a Pi package. Use `-l` for project-local installation. |
| `pi remove <source> [-l]` | Remove an installed Pi package. Use `-l` for project-local removal. |
| `pi uninstall <source> [-l]` | Alias of `pi remove`. |
| `pi update [source\|self\|pi]` | Update Pi and packages, or update a specific source. |
| `pi update --extensions` | Update installed packages only. |
| `pi update --self` | Update Pi itself only. |
| `pi update --extension <src>` | Update one specific package. |
| `pi list` | List installed Pi packages. |
| `pi config` | Enable or disable package resources. |

Modes:

| Command | Purpose |
|---|---|
| `pi` | Start interactive mode. |
| `pi -p "Summarize this codebase"` | Print a single response and exit. |
| `pi --print "Summarize this codebase"` | Same as `pi -p`. |
| `pi --mode json` | Output events as JSON lines. Useful for scripts. |
| `pi --mode rpc` | Start RPC mode over stdin/stdout. Useful for integrations. |
| `pi --export <in> [out]` | Export a saved session to HTML. |

Model options:

| Command | Purpose |
|---|---|
| `pi --provider <name>` | Select a provider, such as `cc-switch-codex` or `cc-switch-claude`. |
| `pi --model <pattern>` | Select a model by ID or pattern. Supports `provider/id` and optional `:<thinking>`. |
| `pi --api-key <key>` | Override the API key for the selected provider. |
| `pi --thinking <off\|minimal\|low\|medium\|high\|xhigh>` | Set the thinking level. |
| `pi --models <patterns>` | Set comma-separated model patterns for Ctrl+P model cycling. |
| `pi --list-models [search]` | List available models, optionally filtered by search text. |

Session options:

| Command | Purpose |
|---|---|
| `pi -c` | Continue the most recent session. |
| `pi --continue` | Same as `pi -c`. |
| `pi -r` | Browse and select a previous session. |
| `pi --resume` | Same as `pi -r`. |
| `pi --session <path\|id>` | Open a specific session file or session ID. |
| `pi --fork <path\|id>` | Fork a session into a new session file. |
| `pi --session-dir <dir>` | Use a custom session storage directory. |
| `pi --no-session` | Start ephemeral mode and do not save the session. |

Tool options:

| Command | Purpose |
|---|---|
| `pi --tools <list>` | Allow only the specified tools. |
| `pi -t <list>` | Same as `pi --tools`. |
| `pi --no-builtin-tools` | Disable built-in tools, while keeping extension and custom tools enabled. |
| `pi -nbt` | Same as `pi --no-builtin-tools`. |
| `pi --no-tools` | Disable all tools. |
| `pi -nt` | Same as `pi --no-tools`. |

Built-in tools include `read`, `bash`, `edit`, `write`, `grep`, `find`, and `ls`.

Resource options:

| Command | Purpose |
|---|---|
| `pi --extension <source>` | Load an extension from a path, npm package, or git source. |
| `pi -e <source>` | Same as `pi --extension`. |
| `pi --no-extensions` | Disable extension discovery. |
| `pi --skill <path>` | Load a skill from a path. |
| `pi --no-skills` | Disable skill discovery. |
| `pi --prompt-template <path>` | Load a prompt template from a path. |
| `pi --no-prompt-templates` | Disable prompt template discovery. |
| `pi --theme <path>` | Load a theme from a path. |
| `pi --no-themes` | Disable theme discovery. |
| `pi --no-context-files` | Disable `AGENTS.md` and `CLAUDE.md` discovery. |
| `pi -nc` | Same as `pi --no-context-files`. |

Other options:

| Command | Purpose |
|---|---|
| `pi --system-prompt <text>` | Replace the default system prompt. |
| `pi --append-system-prompt <text>` | Append text to the system prompt. |
| `pi --verbose` | Force verbose startup output. |
| `pi --help` | Show help. |
| `pi -h` | Same as `pi --help`. |
| `pi --version` | Show Pi version. |
| `pi -v` | Same as `pi --version`. |

File arguments:

| Command | Purpose |
|---|---|
| `pi @prompt.md "Answer this"` | Include `prompt.md` in the initial message. |
| `pi -p @screenshot.png "What's in this image?"` | Include an image in print mode. |
| `pi @code.ts @test.ts "Review these files"` | Include multiple files in the initial message. |

### Pi Built-in Slash Commands

| Command | Purpose |
|---|---|
| `/login` | Manage OAuth or API-key login. |
| `/logout` | Log out or remove credentials. |
| `/model` | Switch models. |
| `/scoped-models` | Enable or disable models for Ctrl+P cycling. |
| `/settings` | Open settings for thinking level, theme, message delivery, and transport. |
| `/resume` | Pick from previous sessions. |
| `/new` | Start a new session. |
| `/name <name>` | Set the current session display name. |
| `/session` | Show session file, ID, messages, tokens, and cost. |
| `/tree` | Jump to any point in the session tree and continue from there. |
| `/fork` | Create a new session from a previous user message. |
| `/clone` | Duplicate the current active branch into a new session. |
| `/compact [prompt]` | Manually compact context, optionally with custom instructions. |
| `/copy` | Copy the last assistant message to clipboard. |
| `/export [file]` | Export the session to HTML. |
| `/share` | Upload the session as a private GitHub gist with a shareable HTML link. |
| `/reload` | Reload keybindings, extensions, skills, prompts, and context files. |
| `/hotkeys` | Show all keyboard shortcuts. |
| `/changelog` | Display Pi version history. |
| `/quit` | Quit Pi. |

### Optional Shortcuts

Install shortcut commands:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-shortcuts.ps1
```

| Shortcut | Expands to | Purpose |
|---|---|---|
| `pi-models` | `pi --list-models cc-switch` | List cc-switch models quickly. |
| `pi-codex` | automatic launcher | Start the cc-switch Codex provider; it detects `https://anyrouter.top/v1` or `https://agentrouter.org/v1` and enables the host-only proxy for that launch. |
| `pi-claude` | `pi --provider cc-switch-claude --model claude-sonnet-4-5` | Start Pi with the cc-switch Claude provider quickly. |

### CC Switch Config Directories

The extension reads CC Switch's device-local `%USERPROFILE%\.cc-switch\settings.json` only for the `claudeConfigDir` and `codexConfigDir` path metadata. Those overrides relocate all imported live files, including the Claude settings file and Codex `auth.json`, `config.toml`, model catalog, and interactive footer watcher. If no override is present, the existing `%USERPROFILE%\.claude` and `%USERPROFILE%\.codex` defaults remain unchanged. Claude's legacy `claude.json` filename is also honored when `settings.json` is absent.

Absolute paths and CC Switch's `~` forms are accepted. Ambiguous relative paths fail closed to the default directories because Pi and the CC Switch GUI can have different working directories. Restart Pi or run `/reload` after changing a directory in CC Switch. No Provider payload, API key, database content, or unrelated CC Switch setting is imported by this path resolver.

### Optional Outbound Network Proxy

A local Clash/Mihomo HTTP proxy is an **outbound network proxy**, not a CC Switch API relay. HTTPS requests whose exact hostname is `anyrouter.top` or `agentrouter.org` use `http://127.0.0.1:7897` by default, so direct `pi` startup needs no proxy environment setup. To override the local proxy port, set the extension-specific variable before starting Pi:

```powershell
$env:PI_CC_SWITCH_ANYROUTER_PROXY = "http://127.0.0.1:7897"
pi
```

Other hosts continue to use Pi's normal direct route. The proxy URL must use `http://` or `https://` and contain only an origin, without a path, query, or fragment. The legacy variable name is retained for compatibility; set `PI_CC_SWITCH_ANYROUTER_PROXY=off` to make both hosts direct.

After running `scripts/install-shortcuts.ps1`, the `pi-codex` shortcut reads the active Codex `config.toml` before launching. When its selected `base_url` is exactly `https://anyrouter.top/v1` or `https://agentrouter.org/v1` (a trailing slash is also accepted), it clears the process-wide proxy variables and enables the dedicated proxy automatically. Other base URLs launch with the existing environment unchanged.

`https://anyrouter.top/` is also a keepwarm entry. When AnyRouter is the active provider, keepwarm requests use the active AnyRouter URL and credentials only; they are not sent back to the FC host. When the FC host is active, the existing AnyRouter fallback behavior remains unchanged.

To proxy every HTTP/HTTPS request made by the Pi process instead, use the standard environment variables:

```powershell
$env:HTTP_PROXY = "http://127.0.0.1:7897"
$env:HTTPS_PROXY = "http://127.0.0.1:7897"
$env:NO_PROXY = "127.0.0.1,localhost,::1"
$env:NODE_USE_ENV_PROXY = "1"
```

`NO_PROXY` keeps loopback addresses direct. Do not combine the global variables with `PI_CC_SWITCH_ANYROUTER_PROXY` when strict host-only routing is required. Do not use port `7897` as `probe:cc-switch --base-url`; that probe requires the optional CC Switch API relay at `127.0.0.1:15721`. The outbound proxy works with direct external relay routes and does not require the CC Switch desktop process.

### Claude Models

The extension registers `cc-switch-claude/current`. In `live` routing mode it re-reads the active Claude settings before each request and follows the route and model selected in cc-switch; in `fixed` mode it uses the snapshot captured at extension load. It also registers the concrete model currently written by cc-switch, such as `mimo-v2.5-pro`.

On top of those, a fixed set is always registered: `claude-fable-5`, `claude-opus-5`, `claude-opus-4-8`, `claude-opus-4-7`, `claude-opus-4-6`, `claude-sonnet-5`, `claude-sonnet-4-6`. All of them are 1M-context models, so the extension enables the 1M beta and the `xhigh` thinking level for them. Your relay still has to have the corresponding channel enabled; fall back to an older model if one of them keeps failing.

Note that a `429 Upstream rate limit exceeded` from a relay is not always a real rate limit — relays reuse that status for request rejection in general. See Upstream Retries below before assuming the relay is busy.

The `opus` / `sonnet` / `haiku` aliases in `settings.json` resolve to `claude-opus-5`, `claude-sonnet-5` and `claude-haiku-4-5-20251001` respectively, unless `ANTHROPIC_DEFAULT_*_MODEL` overrides them.

To add extra fixed models, set `PI_CC_SWITCH_CLAUDE_MODELS` in cc-switch's Claude env config as a comma- or space-separated list. If the live Claude settings file has no selected model, set `PI_CC_SWITCH_CLAUDE_CURRENT_MODEL` to an explicit model ID (for example `claude-opus-5`) so the `current` alias has a safe, explicit target.

### Codex Models

The extension registers `cc-switch-codex/current`. In `live` routing mode Responses requests re-read the active Codex configuration before each request and follow the current cc-switch route, credential, model, and reasoning effort; in `fixed` mode they use the snapshot captured at extension load.

At startup or `/reload`, when the top-level `model_catalog_json` points to the CC Switch-owned filename `cc-switch-model-catalog.json`, the extension imports the catalog's validated model IDs, display names, context windows, reasoning flag, and input modalities. A valid non-empty catalog replaces the fixed Codex list. If the pointer is absent, user-owned, missing, oversized, malformed, or empty, the extension preserves the legacy fallback: the concrete current model plus `gpt-5.5`, `gpt-5.6-sol`, and `gpt-6-astra`.

Only the `current` alias follows later live model changes. Selecting a concrete catalog model sends that selected model ID. Catalog context windows are capped by `PI_CC_SWITCH_CODEX_CONTEXT_WINDOW` (258,400 by default), and the importer ignores every catalog field outside its metadata allowlist. Restart Pi or run `/reload` after CC Switch changes the catalog.

When the effective model is `gpt-5.6-sol`, normal Responses requests use the top-level `model_reasoning_effort` value from `config.toml` directly as `reasoning.effort` (including provider-specific values such as `ultra`) instead of mapping through Pi's built-in thinking levels. The interactive footer watches `config.toml` and displays this effective value instead of the Shift+Tab level. Compaction and branch-summary requests keep their existing recovery-specific reasoning behavior.

### Claude Tools

`cc-switch-claude` exposes Pi tools to Claude with Claude Code-compatible tool names such as `Bash`, `Read`, `Edit`, `MultiEdit`, `Write`, `LS`, `Grep`, and `Glob`. Tool execution still happens inside Pi through Pi's built-in tools; this package does not start a Claude Code subprocess.

### Codex Context and Compaction

`cc-switch-codex` uses a default context window of 258,400 tokens. Early tool-chain compaction starts at 88% (227,392 tokens), leaving 31,008 tokens for continuation and recovery before the window is exhausted. Claude keeps its existing 85% default trigger.

Set `PI_CC_SWITCH_CODEX_CONTEXT_WINDOW` to override the value, for example:

```powershell
$env:PI_CC_SWITCH_CODEX_CONTEXT_WINDOW = "256000"
pi --provider cc-switch-codex --model current
```

Pi compaction and branch-summary requests are sent to Codex without reasoning, even when the active chat uses a high thinking level. This keeps overflow recovery text-only and avoids `invalid_responses_request` errors from Responses-compatible cc-switch proxies. For both Claude and Codex, when `current` resolves to a live model ID, successful responses report the actual request model, while provider errors retain the logical `current` ID so Pi's same-model overflow guard can compact and retry safely.

### Upstream Retries

Requests that fail with `408`, `429`, `500`, `502`, `503`, `504`, or `529` are retried with exponential backoff and jitter (500ms up to 15s per wait, honouring `retry-after`). The default budget is 8 attempts, roughly 45s of waiting in the worst case — account-pool relays flap between `429 Upstream rate limit exceeded` and `503 No available accounts` for tens of seconds when their pool is saturated. Bodies that indicate an insufficient balance or an auth problem are returned immediately instead of burning the budget.

**Retrying does not help a rejected request, and a relay `429` is often a rejection rather than a real rate limit.** Relays fingerprint requests to detect non-Claude-Code clients and answer `429 Upstream rate limit exceeded` when a request looks forged — identical on every attempt. One such trigger was measured on 2026-07-26: sending `metadata.user_id` as Claude Code's full identity envelope (`device_id` + `account_uuid` + `session_id` together) failed 0/5 while the pool was healthy and plain `curl` succeeded 5/5. The extension now sends a single stable hash instead. If every attempt fails with the same status while a minimal `curl` to the same relay and model succeeds, look for a fingerprint trigger rather than raising the retry budget.

Set `PI_CC_SWITCH_UPSTREAM_RETRY_ATTEMPTS` to change the budget (`1` disables retrying):

```powershell
$env:PI_CC_SWITCH_UPSTREAM_RETRY_ATTEMPTS = "12"
```

The dedicated FC endpoint keeps its own unbounded admission retry and is unaffected by this setting.

### Development Checks

```powershell
npm test
npm run check
```

The tests use Node's native TypeScript stripping and cover Claude current-model precedence/alias resolution, CC Switch CLI-directory override resolution, catalog ownership, size/count limits, metadata projection, fallback behavior, concrete-model selection, and context-window capping. `npm run check` is a stripped-TypeScript syntax check, not a strict `tsc` typecheck.

### Security

Do not commit cc-switch credentials. The path resolver reads `%USERPROFILE%\.cc-switch\settings.json` only for the allowlisted `claudeConfigDir` and `codexConfigDir` metadata. Provider registration and model discovery then read these local runtime files from the resolved directories:

- `<Claude config directory>\settings.json` (or legacy `claude.json`)
- `<Codex config directory>\auth.json`
- `<Codex config directory>\config.toml`
- `<Codex config directory>\cc-switch-model-catalog.json`, only when `config.toml` points to the CC Switch-owned filename

The directory resolver ignores every unrelated CC Switch setting, and the catalog importer reads only allowlisted model metadata and never reads Provider credentials from the catalog. The restored legacy FC summary-route implementation still reads `%USERPROFILE%\.cc-switch\cc-switch.db`; removing that behavior remains a separate tracked task.

---

## 中文

这是一个 Pi 扩展，用于读取 cc-switch 当前生效的输出文件，并为 Codex 和 Claude 注册 Pi provider。

### 环境要求

- Node.js 22.19+
- 已全局安装 Pi
- 已在同一个 Windows 用户账号下安装并配置 cc-switch

安装 Pi：

```powershell
npm install -g @earendil-works/pi-coding-agent
```

### 安装

| 命令 | 作用 |
|---|---|
| `pi install git:github.com/Ginkgoooo/pi-cc-switch-provider` | 从 GitHub 安装本扩展。 |

```powershell
pi install git:github.com/Ginkgoooo/pi-cc-switch-provider
```

### cc-switch Provider 命令

| 命令 | 作用 |
|---|---|
| `pi --list-models cc-switch` | 列出本扩展注册的所有 cc-switch 模型。 |
| `pi` | 直接启动 Pi。启动后可在 Pi 内使用 `/model` 选择 cc-switch 模型。 |
| `pi --provider cc-switch-codex --model current` | 使用 cc-switch 导入的 Codex provider，并跟随 cc-switch 当前选择的模型。 |
| `pi --provider cc-switch-claude --model current` | 使用 cc-switch 导入的 Claude provider，并跟随 cc-switch 当前选择的模型。 |
| `pi --provider cc-switch-claude --model mimo-v2.5-pro` | 使用 cc-switch 导入的 Claude provider 和具体模型启动 Pi。可替换为 `pi --list-models cc-switch` 显示的模型。 |
| `/cc-switch` | 在 Pi 内查看当前中转模式及 Codex、Claude provider 导入状态。 |
| `/cc-switch live` | 每次请求实时跟随 cc-switch 当前中转、凭据、模型和 reasoning 配置。 |
| `/cc-switch fixed` | 将 Codex、Claude 固定为扩展 reload 时捕获的完整配置快照。 |
| `/cc-switch toggle` | 在实时与固定模式间切换，并自动 reload 扩展。 |
| `/model` | Pi 内置命令，用于在 Pi 内选择或切换模型。 |

示例：

```powershell
pi --list-models cc-switch
pi
pi --provider cc-switch-codex --model current
pi --provider cc-switch-claude --model current
pi --provider cc-switch-claude --model mimo-v2.5-pro
```

在 Pi 内运行：

```text
/cc-switch
/cc-switch fixed
/cc-switch live
/model
```

### 中转模式

默认使用 `live` 实时跟随模式，以保持原有行为。该模式会在每次 Codex Responses 和 Claude 请求前读取 cc-switch 当前输出文件，并从同一份配置中取得中转地址、凭据、模型、reasoning 和鉴权方式。

`fixed` 固定模式会在扩展加载时捕获 Codex、Claude 的完整配置快照。此后 cc-switch 的切换不会影响请求、页脚、状态输出和保温路由，直到重启 Pi 或执行 `/reload`。`/cc-switch live`、`/cc-switch fixed`、`/cc-switch toggle` 只会将 `routingMode` 持久化到 `%USERPROFILE%\.pi\agent\cc-switch-provider.json`，随后自动 reload 扩展；API Key 只保留在内存中，不会复制到该文件。已有 `codexSummary` 和未知扩展字段会原样保留。

### Pi 内置 CLI 命令

通用语法：

| 命令 | 作用 |
|---|---|
| `pi [options] [@files...] [messages...]` | 启动 Pi，可附带参数、文件引用和初始提示词。 |

包管理命令：

| 命令 | 作用 |
|---|---|
| `pi install <source> [-l]` | 安装 Pi 包。使用 `-l` 表示安装到当前项目。 |
| `pi remove <source> [-l]` | 移除已安装的 Pi 包。使用 `-l` 表示从当前项目移除。 |
| `pi uninstall <source> [-l]` | `pi remove` 的别名。 |
| `pi update [source\|self\|pi]` | 更新 Pi 和包，或更新指定来源。 |
| `pi update --extensions` | 只更新已安装的包。 |
| `pi update --self` | 只更新 Pi 自身。 |
| `pi update --extension <src>` | 更新指定的某一个包。 |
| `pi list` | 列出已安装的 Pi 包。 |
| `pi config` | 启用或禁用包资源。 |

运行模式：

| 命令 | 作用 |
|---|---|
| `pi` | 启动交互模式。 |
| `pi -p "Summarize this codebase"` | 输出一次回答后退出。 |
| `pi --print "Summarize this codebase"` | 等同于 `pi -p`。 |
| `pi --mode json` | 以 JSON lines 输出事件，适合脚本处理。 |
| `pi --mode rpc` | 通过 stdin/stdout 启动 RPC 模式，适合集成。 |
| `pi --export <in> [out]` | 将已保存会话导出为 HTML。 |

模型选项：

| 命令 | 作用 |
|---|---|
| `pi --provider <name>` | 选择 provider，例如 `cc-switch-codex` 或 `cc-switch-claude`。 |
| `pi --model <pattern>` | 按 ID 或匹配模式选择模型，支持 `provider/id` 和可选的 `:<thinking>`。 |
| `pi --api-key <key>` | 为当前 provider 覆盖 API key。 |
| `pi --thinking <off\|minimal\|low\|medium\|high\|xhigh>` | 设置 thinking 等级。 |
| `pi --models <patterns>` | 设置 Ctrl+P 循环切换模型使用的逗号分隔匹配模式。 |
| `pi --list-models [search]` | 列出可用模型，可附带搜索词过滤。 |

会话选项：

| 命令 | 作用 |
|---|---|
| `pi -c` | 继续最近一次会话。 |
| `pi --continue` | 等同于 `pi -c`。 |
| `pi -r` | 浏览并选择历史会话。 |
| `pi --resume` | 等同于 `pi -r`。 |
| `pi --session <path\|id>` | 打开指定会话文件或会话 ID。 |
| `pi --fork <path\|id>` | 将指定会话 fork 为一个新的会话文件。 |
| `pi --session-dir <dir>` | 使用自定义会话存储目录。 |
| `pi --no-session` | 启动临时模式，不保存会话。 |

工具选项：

| 命令 | 作用 |
|---|---|
| `pi --tools <list>` | 只允许使用指定工具。 |
| `pi -t <list>` | 等同于 `pi --tools`。 |
| `pi --no-builtin-tools` | 禁用内置工具，但保留扩展和自定义工具。 |
| `pi -nbt` | 等同于 `pi --no-builtin-tools`。 |
| `pi --no-tools` | 禁用全部工具。 |
| `pi -nt` | 等同于 `pi --no-tools`。 |

内置工具包括 `read`、`bash`、`edit`、`write`、`grep`、`find` 和 `ls`。

资源选项：

| 命令 | 作用 |
|---|---|
| `pi --extension <source>` | 从路径、npm 包或 git 来源加载扩展。 |
| `pi -e <source>` | 等同于 `pi --extension`。 |
| `pi --no-extensions` | 禁用扩展发现。 |
| `pi --skill <path>` | 从路径加载 skill。 |
| `pi --no-skills` | 禁用 skill 发现。 |
| `pi --prompt-template <path>` | 从路径加载提示词模板。 |
| `pi --no-prompt-templates` | 禁用提示词模板发现。 |
| `pi --theme <path>` | 从路径加载主题。 |
| `pi --no-themes` | 禁用主题发现。 |
| `pi --no-context-files` | 禁用 `AGENTS.md` 和 `CLAUDE.md` 自动发现。 |
| `pi -nc` | 等同于 `pi --no-context-files`。 |

其他选项：

| 命令 | 作用 |
|---|---|
| `pi --system-prompt <text>` | 替换默认系统提示词。 |
| `pi --append-system-prompt <text>` | 向系统提示词追加内容。 |
| `pi --verbose` | 强制输出详细启动信息。 |
| `pi --help` | 显示帮助。 |
| `pi -h` | 等同于 `pi --help`。 |
| `pi --version` | 显示 Pi 版本。 |
| `pi -v` | 等同于 `pi --version`。 |

文件参数：

| 命令 | 作用 |
|---|---|
| `pi @prompt.md "Answer this"` | 将 `prompt.md` 带入初始消息。 |
| `pi -p @screenshot.png "What's in this image?"` | 在 print 模式下带入图片。 |
| `pi @code.ts @test.ts "Review these files"` | 将多个文件带入初始消息。 |

### Pi 内置 Slash 命令

| 命令 | 作用 |
|---|---|
| `/login` | 管理 OAuth 或 API key 登录。 |
| `/logout` | 退出登录或移除凭据。 |
| `/model` | 切换模型。 |
| `/scoped-models` | 启用或禁用 Ctrl+P 循环切换时可用的模型。 |
| `/settings` | 打开设置，包括 thinking 等级、主题、消息投递和传输方式。 |
| `/resume` | 从历史会话中选择一个恢复。 |
| `/new` | 开始新会话。 |
| `/name <name>` | 设置当前会话显示名称。 |
| `/session` | 显示会话文件、ID、消息数、token 和费用。 |
| `/tree` | 跳转到会话树中的任意节点并从那里继续。 |
| `/fork` | 从之前的用户消息创建新会话。 |
| `/clone` | 将当前活跃分支复制为新会话。 |
| `/compact [prompt]` | 手动压缩上下文，可附带自定义压缩指令。 |
| `/copy` | 将上一条助手消息复制到剪贴板。 |
| `/export [file]` | 将会话导出为 HTML。 |
| `/share` | 将会话作为私有 GitHub gist 上传，并生成可分享的 HTML 链接。 |
| `/reload` | 重新加载快捷键、扩展、skills、提示词和上下文文件。 |
| `/hotkeys` | 显示所有键盘快捷键。 |
| `/changelog` | 显示 Pi 版本历史。 |
| `/quit` | 退出 Pi。 |

### 可选快捷命令

安装快捷命令：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-shortcuts.ps1
```

| 快捷命令 | 展开后等价于 | 作用 |
|---|---|---|
| `pi-models` | `pi --list-models cc-switch` | 快速列出 cc-switch 模型。 |
| `pi-codex` | 自动判断启动器 | 快速使用 cc-switch Codex provider；检测到 `https://anyrouter.top/v1` 或 `https://agentrouter.org/v1` 时，本次启动自动启用单主机代理。 |
| `pi-claude` | `pi --provider cc-switch-claude --model claude-sonnet-4-5` | 快速使用 cc-switch Claude provider 启动 Pi。 |

### CC Switch 配置目录

扩展只会从 CC Switch 的设备级 `%USERPROFILE%\.cc-switch\settings.json` 读取 `claudeConfigDir` 和 `codexConfigDir` 两项路径元数据。这两个覆盖会同时迁移所有导入的 live 文件，包括 Claude settings、Codex `auth.json` / `config.toml` / model catalog，以及交互式页脚的文件监听。未配置覆盖时，仍使用原来的 `%USERPROFILE%\.claude` 与 `%USERPROFILE%\.codex` 默认目录；Claude 目录中没有 `settings.json` 时，也兼容旧文件名 `claude.json`。

支持绝对路径和 CC Switch 的 `~` 写法。相对路径存在 Pi 与 CC Switch GUI 工作目录不一致的歧义，因此会安全回退默认目录。通过 CC Switch 修改目录后，请重启 Pi 或执行 `/reload`。路径解析器不会导入 Provider 内容、API Key、数据库内容或其它无关 CC Switch 设置。

### 可选的出站网络代理

本机 Clash/Mihomo 的 HTTP 代理属于**出站网络代理**，不是 CC Switch API relay。精确主机名为 `anyrouter.top` 或 `agentrouter.org` 的 HTTPS 请求现在默认使用 `http://127.0.0.1:7897`，因此直接运行 `pi` 无需预先设置代理变量。如需修改本机代理端口，可在启动 Pi 前设置扩展专用变量：

```powershell
$env:PI_CC_SWITCH_ANYROUTER_PROXY = "http://127.0.0.1:7897"
pi
```

其它主机继续使用 Pi 原来的直连路径。代理地址只支持 `http://` 或 `https://`，并且只能填写 origin，不能附带路径、查询参数或 fragment。为兼容已有配置，环境变量名称保持不变；如需让这两个域名都直连，可设置 `PI_CC_SWITCH_ANYROUTER_PROXY=off`。

运行 `scripts/install-shortcuts.ps1` 后，`pi-codex` 快捷命令会在启动前读取当前 Codex `config.toml`。只有选中的 `base_url` 精确为 `https://anyrouter.top/v1` 或 `https://agentrouter.org/v1`（允许末尾 `/`）时，才会清除本次进程的全局代理变量并自动启用专用代理；其它地址保持原环境启动。

`https://anyrouter.top/` 现在也属于保温入口。当前 Provider 为 AnyRouter 时，保温只使用当前 AnyRouter 地址和凭据，不会把凭据反向发送给 FC；当前 Provider 为 FC 时，原有的 AnyRouter 备用入口行为保持不变。

如果希望 Pi 进程的全部 HTTP/HTTPS 请求都经过代理，再使用标准环境变量：

```powershell
$env:HTTP_PROXY = "http://127.0.0.1:7897"
$env:HTTPS_PROXY = "http://127.0.0.1:7897"
$env:NO_PROXY = "127.0.0.1,localhost,::1"
$env:NODE_USE_ENV_PROXY = "1"
```

`NO_PROXY` 让 loopback 地址保持直连。要求严格的单主机代理时，不要同时设置这些全局变量与 `PI_CC_SWITCH_ANYROUTER_PROXY`。不要把 `7897` 作为 `probe:cc-switch --base-url`；该 probe 只接受可选的 CC Switch API relay（默认 `127.0.0.1:15721`）。使用外部中转直连时，只需要出站代理，不需要 CC Switch 桌面进程。

### Claude 模型

该扩展会注册 `cc-switch-claude/current`。在 `live` 模式下，每次请求前都会重新读取当前 Claude settings，跟随 cc-switch 选择的中转和模型；在 `fixed` 模式下，则使用扩展加载时捕获的快照。它也会注册 cc-switch 当前写入的具体模型，例如 `mimo-v2.5-pro`。

在此之外，扩展还会固定注册一组可切换模型：`claude-fable-5`、`claude-opus-5`、`claude-opus-4-8`、`claude-opus-4-7`、`claude-opus-4-6`、`claude-sonnet-5`、`claude-sonnet-4-6`。它们都是 1M 上下文模型，扩展会为其开启 1M beta 和 `xhigh` 思考档位。能否真正调用仍取决于中转是否开通对应渠道，某个模型持续失败就换旧版本。

注意中转返回的 `429 Upstream rate limit exceeded` 未必是真的限流——中转会用这个状态码兜底各种拒绝。先看下面的「中转重试」一节，别急着认定是中转忙。

`settings.json` 里的 `opus` / `sonnet` / `haiku` 别名分别解析为 `claude-opus-5`、`claude-sonnet-5`、`claude-haiku-4-5-20251001`，除非 `ANTHROPIC_DEFAULT_*_MODEL` 另有覆盖。

如需追加固定模型，可在 cc-switch 的 Claude env 配置中设置 `PI_CC_SWITCH_CLAUDE_MODELS`，使用英文逗号或空格分隔多个模型。如果 live Claude settings 没有记录当前模型，可设置 `PI_CC_SWITCH_CLAUDE_CURRENT_MODEL` 为明确的模型 ID（例如 `claude-opus-5`），让 `current` alias 有一个安全且明确的目标。

### Claude 工具

`cc-switch-claude` 会用 `Bash`、`Read`、`Edit`、`MultiEdit`、`Write`、`LS`、`Grep`、`Glob` 等 Claude Code 兼容工具名向 Claude 暴露 Pi 工具。工具执行仍由 Pi 内置工具完成，本包不会启动 Claude Code 子进程。

### Codex 模型

该扩展会注册 `cc-switch-codex/current`。在 `live` 模式下，Responses 请求会在每次调用前读取 Codex 当前配置，跟随 cc-switch 当前中转、凭据、模型和 reasoning effort；在 `fixed` 模式下，则使用扩展加载时捕获的快照。

启动或执行 `/reload` 时，如果顶层 `model_catalog_json` 指向 CC Switch 所有的文件名 `cc-switch-model-catalog.json`，扩展会导入 catalog 中通过校验的模型 ID、显示名、上下文窗口、reasoning 标记和输入模态。有效且非空的 catalog 会替代固定 Codex 列表；如果指针缺失、属于用户自定义文件、文件不存在、过大、格式错误或为空，则保留旧回退列表：当前具体模型以及 `gpt-5.5`、`gpt-5.6-sol`、`gpt-6-astra`。

只有 `current` alias 会继续跟随之后的 live 模型变化；选择 catalog 中的具体模型时，请求会保留该模型 ID。catalog 上下文仍受 `PI_CC_SWITCH_CODEX_CONTEXT_WINDOW` 限制（默认 258,400），导入器会忽略元数据白名单之外的全部字段。CC Switch 修改 catalog 后，需要重启 Pi 或执行 `/reload`。

实际模型为 `gpt-5.6-sol` 时，普通 Responses 请求会直接读取 `config.toml` 顶层的 `model_reasoning_effort`，并原样作为 `reasoning.effort` 发送（包括 `ultra` 等中转自定义值），不再经过 Pi 内置 thinking 档位映射。交互式页脚会监听 `config.toml`，并用该实际生效值覆盖 Shift+Tab 档位显示。上下文压缩和分支摘要请求继续保留既有的恢复专用 reasoning 策略。

### Codex 上下文与压缩

`cc-switch-codex` 默认使用 258,400 token 上下文窗口。工具链提前压缩默认在 88%（227,392 token）触发，在耗尽窗口前保留 31,008 token 供任务续接和异常恢复；Claude 继续使用原有的 85% 默认触发比例。

如需覆盖该值，可设置 `PI_CC_SWITCH_CODEX_CONTEXT_WINDOW`，例如：

```powershell
$env:PI_CC_SWITCH_CODEX_CONTEXT_WINDOW = "256000"
pi --provider cc-switch-codex --model current
```

Pi 的上下文压缩和分支摘要请求会以无 reasoning 的纯文本请求发给 Codex，即使当前聊天使用 high thinking。这样可以降低 Responses 兼容 cc-switch 中转在溢出恢复时返回 `invalid_responses_request` 的概率。对于 Claude 和 Codex，`current` 解析到 live 模型后，成功响应会记录实际请求模型；Provider 错误则保留逻辑上的 `current` ID，确保 Pi 的 same-model 溢出检查能够安全触发压缩和重试。

### 中转重试

返回 `408`、`429`、`500`、`502`、`503`、`504`、`529` 的请求会按指数退避加抖动重试（单次等待 500ms 至 15s，优先遵守 `retry-after`），默认预算 8 次尝试、最坏约 45 秒。号池型中转在账号被占满时，会在 `429 Upstream rate limit exceeded` 和 `503 No available accounts` 之间抖动几十秒。响应体判定为余额不足或鉴权失败时会立即返回，不浪费重试预算。

**被拒绝的请求重试多少次都没用，而中转的 `429` 往往就是拒绝而非限流。** 中转会对请求做指纹识别以发现非 Claude Code 客户端，判定为伪造时同样返回 `429 Upstream rate limit exceeded`，且每次尝试结果完全一致。2026-07-26 实测到一个触发点：`metadata.user_id` 发送 Claude Code 的完整身份信封（`device_id` + `account_uuid` + `session_id` 三者同时出现）时，在池子健康、裸 `curl` 5/5 成功的同时该请求 0/5 全挂。扩展现已改为只发单个稳定哈希。如果每次尝试都是同一个状态码，而同中转同模型的最小 `curl` 能成功，应该去找指纹触发点，而不是加大重试预算。

如需调整预算，可设置 `PI_CC_SWITCH_UPSTREAM_RETRY_ATTEMPTS`（设为 `1` 即关闭重试）：

```powershell
$env:PI_CC_SWITCH_UPSTREAM_RETRY_ATTEMPTS = "12"
```

FC 专用域名保留原有的无限入场重试，不受该设置影响。

### 开发验证

```powershell
npm test
npm run check
```

测试使用 Node 原生 TypeScript stripping，覆盖 Claude current 模型优先级/别名解析、CC Switch CLI 目录覆盖解析、catalog ownership、大小/数量限制、元数据投影、回退行为、具体模型选择和上下文上限。`npm run check` 是剥离 TypeScript 类型后的语法检查，并不等同于严格的 `tsc` 类型检查。

### 安全说明

不要提交 cc-switch 凭据。路径解析器只会从 `%USERPROFILE%\.cc-switch\settings.json` 读取白名单内的 `claudeConfigDir` 与 `codexConfigDir` 元数据。Provider 注册与模型发现随后从解析出的目录读取以下本地运行时文件：

- `<Claude 配置目录>\settings.json`（或旧文件名 `claude.json`）
- `<Codex 配置目录>\auth.json`
- `<Codex 配置目录>\config.toml`
- `<Codex 配置目录>\cc-switch-model-catalog.json`，且仅当 `config.toml` 指向 CC Switch 所有的文件名时

目录解析器会忽略其它全部 CC Switch 设置；catalog 导入器只读取白名单模型元数据，不从 catalog 读取 Provider 凭据。当前已还原的 legacy FC summary route 仍会读取 `%USERPROFILE%\.cc-switch\cc-switch.db`；移除该行为仍是另一项已跟踪任务。
