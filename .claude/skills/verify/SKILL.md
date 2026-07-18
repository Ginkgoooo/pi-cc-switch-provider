---
name: verify
description: Verify provider registration and compat dispatch through Pi RPC.
---

# Verify

Use Pi's real RPC surface with an isolated `HOME` and explicit extension paths.

1. Create temporary `.claude/settings.json`, `.codex/auth.json`, and `.codex/config.toml` fixtures.
2. Disable keepwarm with `PI_CC_SWITCH_FCAPP_KEEPWARM=0` and run:

```bash
pi --mode rpc --offline --no-session \
  --provider cc-switch-claude --model current \
  --extension ./extensions/cc-switch-provider.ts \
  --extension ./tests/fixtures/runtime-verifier.ts
```

3. Send RPC `prompt` commands sequentially and wait for each response. A verifier extension can expose commands that inspect `ctx.modelRegistry`, call public `@earendil-works/pi-ai/compat` APIs, and emit observations through `ctx.ui.notify()`.
4. Exercise initial dispatch, `resetApiProviders()`, `ctx.reload()`, and dispatch after reload. Use mocked `fetch` SSE responses so verification stays offline.

Gotcha: piping all RPC commands at once creates command races. Drive them one at a time and wait for both the command response and expected notification.
