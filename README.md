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

### Commands

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

Select or switch models inside Pi:

```text
/model
```

### Optional Shortcuts

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-shortcuts.ps1
```

Then use:

```powershell
pi-models
pi-codex
pi-claude
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

### 命令清单

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

在 Pi 内选择或切换模型：

```text
/model
```

### 可选快捷命令

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-shortcuts.ps1
```

安装后可使用：

```powershell
pi-models
pi-codex
pi-claude
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
