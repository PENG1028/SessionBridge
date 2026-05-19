# 07 — CLI & Config Layer

Verifies CLI commands exist, match docs, and the config→auth→API chain works end-to-end.

## Code Modules Exercised

| Module | Path | Role |
|--------|------|------|
| CLI entry | `src/index.ts` | arg parsing, command dispatch |
| Config loader | `src/configuration/config.ts` | file + env + CLI merge |
| API routes | `src/api-routes.ts` | HTTP endpoints consumed by CLI |
| Auth system | `src/relay-server.ts` | dashboardToken / relayToken checks |

## Tests

### 1. `cli-command-existence.test.mjs`
Every command in CLI_REFERENCE.md actually exists in the CLI. Detects stale-doc references.

### 2. `cli-config-auth.test.mjs`
Config file → auth system → HTTP API chain. Starts a real relay with temp config containing dashboardToken, asserts every step of auth flow via HTTP.

### 3. `cli-api-parity.test.mjs`
CLI `--json` output schemas are structurally consistent with corresponding HTTP API responses.
