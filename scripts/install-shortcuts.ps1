$ErrorActionPreference = "Stop"

$prefix = (npm config get prefix).Trim()

Set-Content -LiteralPath (Join-Path $prefix "pi-codex.cmd") -Encoding ASCII -Value "@echo off`r`npi --provider cc-switch-codex --model gpt-5.5 %*`r`n"
Set-Content -LiteralPath (Join-Path $prefix "pi-claude.cmd") -Encoding ASCII -Value "@echo off`r`npi --provider cc-switch-claude --model claude-sonnet-4-5 %*`r`n"
Set-Content -LiteralPath (Join-Path $prefix "pi-models.cmd") -Encoding ASCII -Value "@echo off`r`npi --list-models cc-switch %*`r`n"

Write-Output "Installed shortcuts:"
Write-Output (Join-Path $prefix "pi-codex.cmd")
Write-Output (Join-Path $prefix "pi-claude.cmd")
Write-Output (Join-Path $prefix "pi-models.cmd")
