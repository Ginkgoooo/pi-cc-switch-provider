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

### Verify

```powershell
pi --list-models cc-switch
```

### Usage

```powershell
pi --provider cc-switch-codex --model gpt-5.5
pi --provider cc-switch-claude --model claude-sonnet-4-5
pi --provider cc-switch-claude --model claude-opus-4-7
```

Inside Pi, run:

```text
/cc-switch
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

### 验证

```powershell
pi --list-models cc-switch
```

### 使用方式

```powershell
pi --provider cc-switch-codex --model gpt-5.5
pi --provider cc-switch-claude --model claude-sonnet-4-5
pi --provider cc-switch-claude --model claude-opus-4-7
```

在 Pi 内部可运行：

```text
/cc-switch
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
