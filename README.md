# pi-cc-switch-provider

Pi extension that reads the active cc-switch output files and registers Pi providers for Codex and Claude.

## Requirements

- Node.js 20+
- Pi installed globally
- cc-switch installed and configured on the same Windows user account

Install Pi:

```powershell
npm install -g @earendil-works/pi-coding-agent
```

## Install

```powershell
pi install git:github.com/Ginkgoooo/pi-cc-switch-provider
```

## Verify

```powershell
pi --list-models cc-switch
```

## Usage

```powershell
pi --provider cc-switch-codex --model gpt-5.5
pi --provider cc-switch-claude --model claude-sonnet-4-5`r`npi --provider cc-switch-claude --model claude-opus-4-7
```

Inside Pi, run:

```text
/cc-switch
```

## Optional Shortcuts

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-shortcuts.ps1
```

Then use:

```powershell
pi-models
pi-codex
pi-claude
```

## Claude Models

The extension registers several common Claude model IDs because cc-switch providers may route models automatically without writing a single model to .claude/settings.json.

Default Claude model IDs include:

- claude-opus-4-7`r
- claude-opus-4-5`r
- claude-sonnet-4-5`r
- claude-sonnet-4`r
- claude-opus-4`r

To override or add models, set PI_CC_SWITCH_CLAUDE_MODELS in cc-switch's Claude env config as a comma- or space-separated list.

## Security

Do not commit cc-switch credentials. This package only reads local files created by cc-switch:

- `%USERPROFILE%\.claude\settings.json`
- `%USERPROFILE%\.codex\auth.json`
- `%USERPROFILE%\.codex\config.toml`



