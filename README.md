# pi-cc-switch-provider

[English](#english) | [中文](#中文)

---

## English

Pi extension that reads the active cc-switch output files and registers Pi providers for Codex and Claude.

### Requirements

- Node.js 20+
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
| `/cc-switch` | Show the import status of cc-switch Codex and Claude providers inside Pi. |
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
/model
```

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
| `pi-codex` | `pi --provider cc-switch-codex --model current` | Start Pi with the cc-switch Codex provider quickly. |
| `pi-claude` | `pi --provider cc-switch-claude --model claude-sonnet-4-5` | Start Pi with the cc-switch Claude provider quickly. |

### Claude Models

The extension registers `cc-switch-claude/current`, which re-reads `%USERPROFILE%\.claude\settings.json` before each request and follows the current model selected in cc-switch. It also registers the concrete model currently written by cc-switch, such as `mimo-v2.5-pro`.

To add extra fixed models, set `PI_CC_SWITCH_CLAUDE_MODELS` in cc-switch's Claude env config as a comma- or space-separated list.

### Codex Models

The extension registers `cc-switch-codex/current`, which re-reads `%USERPROFILE%\.codex\config.toml` before each request and follows the current model selected in cc-switch. It also registers the concrete current model plus fixed entries for `gpt-5.5` and `gpt-5.6-sol`.

### Claude Tools

`cc-switch-claude` exposes Pi tools to Claude with Claude Code-compatible tool names such as `Bash`, `Read`, `Edit`, `MultiEdit`, `Write`, `LS`, `Grep`, and `Glob`. Tool execution still happens inside Pi through Pi's built-in tools; this package does not start a Claude Code subprocess.

### Codex Context and Compaction

`cc-switch-codex` uses a conservative default context window of 200,000 tokens. This helps Pi compact before the upstream cc-switch Codex channel rejects a request with `context_length_exceeded`, even if the displayed Codex model advertises a larger cached context.

Set `PI_CC_SWITCH_CODEX_CONTEXT_WINDOW` to override the value, for example:

```powershell
$env:PI_CC_SWITCH_CODEX_CONTEXT_WINDOW = "256000"
pi --provider cc-switch-codex --model current
```

Pi compaction and branch-summary requests are sent to Codex without reasoning, even when the active chat uses a high thinking level. This keeps overflow recovery text-only and avoids `invalid_responses_request` errors from Responses-compatible cc-switch proxies.

### Security

Do not commit cc-switch credentials. This package only reads local files created by cc-switch:

- `%USERPROFILE%\.claude\settings.json`
- `%USERPROFILE%\.codex\auth.json`
- `%USERPROFILE%\.codex\config.toml`

---

## 中文

这是一个 Pi 扩展，用于读取 cc-switch 当前生效的输出文件，并为 Codex 和 Claude 注册 Pi provider。

### 环境要求

- Node.js 20+
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
| `/cc-switch` | 在 Pi 内查看 cc-switch Codex 和 Claude provider 的导入状态。 |
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
/model
```

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
| `pi-codex` | `pi --provider cc-switch-codex --model current` | 快速使用 cc-switch Codex provider 启动 Pi。 |
| `pi-claude` | `pi --provider cc-switch-claude --model claude-sonnet-4-5` | 快速使用 cc-switch Claude provider 启动 Pi。 |

### Claude 模型

该扩展会注册 `cc-switch-claude/current`，并在每次请求前重新读取 `%USERPROFILE%\.claude\settings.json`，跟随 cc-switch 当前选择的模型。它也会注册 cc-switch 当前写入的具体模型，例如 `mimo-v2.5-pro`。

如需追加固定模型，可在 cc-switch 的 Claude env 配置中设置 `PI_CC_SWITCH_CLAUDE_MODELS`，使用英文逗号或空格分隔多个模型。

### Claude 工具

`cc-switch-claude` 会用 `Bash`、`Read`、`Edit`、`MultiEdit`、`Write`、`LS`、`Grep`、`Glob` 等 Claude Code 兼容工具名向 Claude 暴露 Pi 工具。工具执行仍由 Pi 内置工具完成，本包不会启动 Claude Code 子进程。

### Codex 模型

该扩展会注册 `cc-switch-codex/current`，并在每次请求前重新读取 `%USERPROFILE%\.codex\config.toml`，跟随 cc-switch 当前选择的模型。同时会注册当前具体模型，并固定额外注册 `gpt-5.5` 和 `gpt-5.6-sol`。

### Codex 上下文与压缩

`cc-switch-codex` 默认使用保守的 200,000 token 上下文窗口。即使 Codex 模型展示了更大的缓存上下文，这也能让 Pi 在上游 cc-switch Codex 通道返回 `context_length_exceeded` 前提前压缩。

如需覆盖该值，可设置 `PI_CC_SWITCH_CODEX_CONTEXT_WINDOW`，例如：

```powershell
$env:PI_CC_SWITCH_CODEX_CONTEXT_WINDOW = "256000"
pi --provider cc-switch-codex --model current
```

Pi 的上下文压缩和分支摘要请求会以无 reasoning 的纯文本请求发给 Codex，即使当前聊天使用 high thinking。这样可以降低 Responses 兼容 cc-switch 中转在溢出恢复时返回 `invalid_responses_request` 的概率。

### 安全说明

不要提交 cc-switch 凭据。本包只读取 cc-switch 在本地创建的文件：

- `%USERPROFILE%\.claude\settings.json`
- `%USERPROFILE%\.codex\auth.json`
- `%USERPROFILE%\.codex\config.toml`

### 友情链接
https://linux.do/
