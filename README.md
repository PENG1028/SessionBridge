# SessionBridge Web

Web UI and plugin host for [SessionBridge Core](https://github.com/PENG1028/sessionbridge-core) nodes.

> ⚠️ **Early stage.** The Web UI is under active development. Many Core capabilities
> (68 registered) do not yet have UI surfaces. See [Current State](#current-state).

## Architecture

```
sessionbridge-core (Go)          sessionbridge-web (Next.js) ← this repo
├── 68 capabilities              ├── app/        UI layer
├── mesh / peer / invite         ├── plugins/    terminal, mesh, approvals...
├── session / stream / run       ├── sdk/        plugin API surface
└── ws://127.0.0.1:9090/ws       └── lib/        shared helpers
           │
           └── WebSocket ────────────── CoreClient / SSE bridge
```

The web repo does **not** contain Core source. Get Core separately:
- [sessionbridge-core releases](https://github.com/PENG1028/sessionbridge-core/releases)
- or `go install github.com/PENG1028/sessionbridge-core/cmd/node@latest`

## Quick Start

```bash
# 1. Start Core (separate repo)
git clone https://github.com/PENG1028/sessionbridge-core.git
cd sessionbridge-core && go build ./cmd/node/ && ./sessionnode

# 2. Start Web UI (this repo)
git clone https://github.com/PENG1028/sessionbridge-web.git
cd sessionbridge-web
npm install
npm run dev        # → http://localhost:3000
```

Development expects Core at `ws://127.0.0.1:9090/ws`. Override with `SESSIONBRIDGE_CORE_WS_URL`.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Next.js dev server (LAN: 0.0.0.0:3000) |
| `npm run dev:web` | Same as `npm run dev` |
| `npm run build` | Next.js production build |
| `npm start` | Start Next.js production server |
| `npm test` | Run tests (vitest) |

Core-related scripts (`dev:core`, `start:core`) detect a sibling `sessionbridge-core` repo or fall back to `sessionnode` on PATH.

## Current State

### What works
- **Terminal** — PTY-backed shell with xterm.js rendering, stream replay, resize
- **Mesh** — peer invite/create/accept flow, node card with reconnect
- **File tree** — browse and basic file write
- **Plugin system** — manifest-based views, commands, configuration panels
- **Settings** — Core binary path, port, update check, plugin configs
- **Approvals** — notification center for permission requests

### Known gaps
- **Terminal is a work-in-progress** — mobile input, OSC 7 integration, and session restore need polish
- **~50 Core capabilities have no UI** — logs, audit, env vars, session history, task manager, full file ops, node management, update policies
- **Plugin management** (`plugin.*` capabilities) lives in Next.js API routes, not Core — the Core-side plugin system was planned but not built
- **No static export** — requires `next start` with `.next/` build output
- **Single-view focus** — multi-tab/pane layout exists but edge cases remain

### What's solid
The [Core](https://github.com/PENG1028/sessionbridge-core) is production-quality — 68 capabilities with tests, mesh networking, PTY management, and self-update. The web UI is the official frontend but the Core can be used headless or with any WebSocket client.

## Plugin Model

`plugins/*/plugin.yaml` is the only plugin declaration source. Plugins contribute:
- Views and panels
- Commands
- Configuration schemas
- Core capability permissions

Plugin SDK at `sdk/` re-exports hooks, components, and types for plugin authors.

## Documentation

| Document | Purpose |
|---|---|
| [docs/access-model.md](docs/access-model.md) | Relay, Leaf, View, connection semantics |
| [docs/core-v2/core-kernel/PUBLIC_MESH_SECURITY.md](docs/core-v2/core-kernel/PUBLIC_MESH_SECURITY.md) | Mesh security and pairing |
| [docs/development.md](docs/development.md) | Development and deployment |

## License

MIT
