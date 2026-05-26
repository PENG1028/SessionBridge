# SessionBridge

SessionBridge is a personal Core mesh and App UI for operating terminals,
plugins, and long-running tasks across trusted machines.

Current runtime:

- Go Core is the only Core runtime.
- App UI is the first-party Next.js UI.
- Plugins are declared with `plugins/*/plugin.yaml`.
- Old Node relay, old extension runtime, and Flutter app have been removed.

## Quick Start

```bash
npm install
npm run build
npm start
```

Development:

```bash
npm run dev       # Go Core + Next.js dev server
npm run dev:core  # Go Core only
npm run dev:web   # Next.js only
```

## Commands

| Command | Purpose |
|---|---|
| `npm start` | Start Go Core |
| `npm run dev` | Start Go Core and Next.js dev server |
| `npm run build` | Build Next.js and Go Core |
| `npm run build:core` | Build Go Core |
| `npm run build:web` | Build Next.js |
| `npm run package` | Assemble portable package |

## Core Concepts

| Term | Meaning |
|---|---|
| Core Node | A running Go Core instance with identity and capability handlers. |
| Relay | A Core node that is publicly reachable or acts as a mesh entry/middle node. |
| Leaf | A Core node that usually connects outbound to a Relay. |
| View | A browser/client without Core identity. It accesses App UI and operates nodes through UI. |

See [docs/access-model.md](docs/access-model.md) for the canonical definitions.

## Runtime Layout

```text
go-core/   Go Core runtime
app/       App UI
lib/       browser/client helpers
plugins/   plugin.yaml declarations
content/   web copy/content used by App UI
examples/  plugin examples
docs/      design and decision records
```

Removed legacy paths:

```text
src/          old Node relay runtime
agent-core/   old extension runtime
extensions/   old extension tree
flutter_app/  old Flutter client
```

## Security Model

There are two separate security layers:

1. App UI access for humans and browser Views.
2. Core-to-Core mesh trust for nodes.

Core endpoints:

| Endpoint | Purpose | Security |
|---|---|---|
| `/ws` | App UI/control WebSocket | `SESSIONNODE_TOKEN` when exposed |
| `/peer/ws` | Core-to-Core mesh | ed25519 challenge-response |
| `/peer/invite/accept` | One-time peer pairing | short-lived invite code |

Do not expose `/ws` publicly without `SESSIONNODE_TOKEN`.

## Plugin Model

`plugins/*/plugin.yaml` is the only plugin declaration source. App UI reads
plugin declarations from Core and renders host-provided or manifest-declared
surfaces.

## Documentation

| Document | Purpose |
|---|---|
| [docs/access-model.md](docs/access-model.md) | Relay, Leaf, View, and connection semantics |
| [docs/core-v2/core-kernel/PUBLIC_MESH_SECURITY.md](docs/core-v2/core-kernel/PUBLIC_MESH_SECURITY.md) | Core mesh security and pairing |
| [docs/core-v2/app-ui/APP_UI_API_MAP.md](docs/core-v2/app-ui/APP_UI_API_MAP.md) | App UI to Core API map |
| [docs/development.md](docs/development.md) | Development and deployment notes |

## License

MIT
