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

```powershell
pi install git:github.com/Ginkgoooo/pi-cc-switch-provider
```

### cc-switch Provider Commands

List all cc-switch models:

```powershell
pi --list-models cc-switch
```

Start Pi directly, then select a model inside Pi:

```powershell
pi
```

```text
/model
```

Start Pi with the active Codex model imported from cc-switch:

```powershell
pi --provider cc-switch-codex --model gpt-5.5
```

Start Pi with a specific Claude model imported from cc-switch:

```powershell
pi --provider cc-switch-claude --model claude-sonnet-4-5
pi --provider cc-switch-claude --model claude-opus-4-7
```

Show cc-switch provider import status inside Pi:

```text
/cc-switch
```

### Pi Built-in CLI Commands

General syntax:

```bash
pi [options] [@files...] [messages...]
```

Package commands:

```bash
pi install <source> [-l]
pi remove <source> [-l]
pi uninstall <source> [-l]
pi update [source|self|pi]
pi update --extensions
pi update --self
pi update --extension <src>
pi list
pi config
```

Modes:

```bash
pi
pi -p "Summarize this codebase"
pi --print "Summarize this codebase"
pi --mode json
pi --mode rpc
pi --export <in> [out]
```

Model options:

```bash
pi --provider <name>
pi --model <pattern>
pi --api-key <key>
pi --thinking <off|minimal|low|medium|high|xhigh>
pi --models <patterns>
pi --list-models [search]
```

Session options:

```bash
pi -c
pi --continue
pi -r
pi --resume
pi --session <path|id>
pi --fork <path|id>
pi --session-dir <dir>
pi --no-session
```

Tool options:

```bash
pi --tools <list>
pi -t <list>
pi --no-builtin-tools
pi -nbt
pi --no-tools
pi -nt
```

Built-in tools include `read`, `bash`, `edit`, `write`, `grep`, `find`, and `ls`.

Resource options:

```bash
pi --extension <source>
pi -e <source>
pi --no-extensions
pi --skill <path>
pi --no-skills
pi --prompt-template <path>
pi --no-prompt-templates
pi --theme <path>
pi --no-themes
pi --no-context-files
pi -nc
```

Other options:

```bash
pi --system-prompt <text>
pi --append-system-prompt <text>
pi --verbose
pi --help
pi -h
pi --version
pi -v
```

File arguments:

```bash
pi @prompt.md "Answer this"
pi -p @screenshot.png "What's in this image?"
pi @code.ts @test.ts "Review these files"
```

### Pi Built-in Slash Commands

```text
/login
/logout
/model
/scoped-models
/settings
/resume
/new
/name <name>
/session
/tree
/fork
/clone
/compact [prompt]
/copy
/export [file]
/share
/reload
/hotkeys
/changelog
/quit
```

### Optional Shortcuts

Install shortcut commands:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-shortcuts.ps1
```

Then use:

```powershell
pi-models
pi-codex
pi-claude
```

The shortcuts expand to:

```powershell
pi-models  # pi --list-models cc-switch
pi-codex   # pi --provider cc-switch-codex --model gpt-5.5
pi-claude  # pi --provider cc-switch-claude --model claude-sonnet-4-5
```

### Claude Models

The extension registers several common Claude model IDs because cc-switch providers may route models automatically without writing a single model to `.claude/settings.json`.

Default Claude model IDs include:

- `claude-opus-4-7`
- `claude-opus-4-5`
- `claude-sonnet-4-5`
- `claude-sonnet-4`
- `claude-opus-4`

To override or add models, set `PI_CC_SWITCH_CLAUDE_MODELS` in cc-switch's Claude env config as a comma- or space-separated list.

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

```powershell
pi install git:github.com/Ginkgoooo/pi-cc-switch-provider
```

### cc-switch Provider 命令

列出所有 cc-switch 模型：

```powershell
pi --list-models cc-switch
```

直接启动 Pi，然后在 Pi 内选择模型：

```powershell
pi
```

```text
/model
```

使用 cc-switch 导入的当前 Codex 模型启动 Pi：

```powershell
pi --provider cc-switch-codex --model gpt-5.5
```

使用 cc-switch 导入的指定 Claude 模型启动 Pi：

```powershell
pi --provider cc-switch-claude --model claude-sonnet-4-5
pi --provider cc-switch-claude --model claude-opus-4-7
```

在 Pi 内查看 cc-switch provider 导入状态：

```text
/cc-switch
```

### Pi 内置 CLI 命令

通用语法：

```bash
pi [options] [@files...] [messages...]
```

包管理命令：

```bash
pi install <source> [-l]
pi remove <source> [-l]
pi uninstall <source> [-l]
pi update [source|self|pi]
pi update --extensions
pi update --self
pi update --extension <src>
pi list
pi config
```

运行模式：

```bash
pi
pi -p "Summarize this codebase"
pi --print "Summarize this codebase"
pi --mode json
pi --mode rpc
pi --export <in> [out]
```

模型选项：

```bash
pi --provider <name>
pi --model <pattern>
pi --api-key <key>
pi --thinking <off|minimal|low|medium|high|xhigh>
pi --models <patterns>
pi --list-models [search]
```

会话选项：

```bash
pi -c
pi --continue
pi -r
pi --resume
pi --session <path|id>
pi --fork <path|id>
pi --session-dir <dir>
pi --no-session
```

工具选项：

```bash
pi --tools <list>
pi -t <list>
pi --no-builtin-tools
pi -nbt
pi --no-tools
pi -nt
```

内置工具包括 `read`、`bash`、`edit`、`write`、`grep`、`find` 和 `ls`。

资源选项：

```bash
pi --extension <source>
pi -e <source>
pi --no-extensions
pi --skill <path>
pi --no-skills
pi --prompt-template <path>
pi --no-prompt-templates
pi --theme <path>
pi --no-themes
pi --no-context-files
pi -nc
```

其他选项：

```bash
pi --system-prompt <text>
pi --append-system-prompt <text>
pi --verbose
pi --help
pi -h
pi --version
pi -v
```

文件参数：

```bash
pi @prompt.md "Answer this"
pi -p @screenshot.png "What's in this image?"
pi @code.ts @test.ts "Review these files"
```

### Pi 内置 Slash 命令

```text
/login
/logout
/model
/scoped-models
/settings
/resume
/new
/name <name>
/session
/tree
/fork
/clone
/compact [prompt]
/copy
/export [file]
/share
/reload
/hotkeys
/changelog
/quit
```

### 可选快捷命令

安装快捷命令：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-shortcuts.ps1
```

安装后可使用：

```powershell
pi-models
pi-codex
pi-claude
```

快捷命令展开后等价于：

```powershell
pi-models  # pi --list-models cc-switch
pi-codex   # pi --provider cc-switch-codex --model gpt-5.5
pi-claude  # pi --provider cc-switch-claude --model claude-sonnet-4-5
```

### Claude 模型

该扩展会注册多个常见 Claude 模型 ID，因为 cc-switch provider 可能会自动路由模型，而不一定会把单个模型写入 `.claude/settings.json`。

默认 Claude 模型 ID 包括：

- `claude-opus-4-7`
- `claude-opus-4-5`
- `claude-sonnet-4-5`
- `claude-sonnet-4`
- `claude-opus-4`

如需覆盖或追加模型，可在 cc-switch 的 Claude env 配置中设置 `PI_CC_SWITCH_CLAUDE_MODELS`，使用英文逗号或空格分隔多个模型。

### 安全说明

不要提交 cc-switch 凭据。本包只读取 cc-switch 在本地创建的文件：

- `%USERPROFILE%\.claude\settings.json`
- `%USERPROFILE%\.codex\auth.json`
- `%USERPROFILE%\.codex\config.toml`
