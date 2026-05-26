# Core v2 Documentation Index

This directory contains active architecture documents for the current Go Core
and App UI system.

If any active document conflicts with [../access-model.md](../access-model.md)
or [../../CLAUDE.md](../../CLAUDE.md), the newer canonical rules win.

## Canonical Documents

| Area | Document | Purpose |
|---|---|---|
| Access model | [../access-model.md](../access-model.md) | Relay, Leaf, View, and connection lifecycle |
| Core mesh security | [core-kernel/PUBLIC_MESH_SECURITY.md](core-kernel/PUBLIC_MESH_SECURITY.md) | `/ws`, `/peer/ws`, invite pairing, trust store |
| App UI contract | [app-ui/APP_UI_PLUGIN.md](app-ui/APP_UI_PLUGIN.md) | App UI/Core/plugin boundaries |
| App UI features | [app-ui/APP_UI_FEATURES.md](app-ui/APP_UI_FEATURES.md) | First-party UI feature ownership |
| App UI API map | [app-ui/APP_UI_API_MAP.md](app-ui/APP_UI_API_MAP.md) | App UI calls into Core |
| Plugin capabilities | [plugin-platform/CAPABILITY_STATUS.md](plugin-platform/CAPABILITY_STATUS.md) | Implemented capabilities and status |
| Session and stream | [core-kernel/SESSION_AND_STREAM.md](core-kernel/SESSION_AND_STREAM.md) | Sessions, streams, runs, history |

## Directory Ownership

| Directory | Owner | Notes |
|---|---|---|
| `core-kernel/` | Core | Go Core protocol, mesh, session, stream, update, audit |
| `app-ui/` | UI | First-party App UI, plugin host, surface model |
| `plugin-platform/` | Plugin | `plugin.yaml`, capabilities, lifecycle, examples |
| `access-control/` | Security | permissions and policy model |
| `test-scenarios/` | QA | scenario-level tests and acceptance cases |
| `cli/` | CLI | CLI adapter contracts and command routing |

## Current Naming

Use these names in new docs:

- App UI, not System UI
- Go Core, not Node relay
- plugin, not extension
- `plugin.yaml`, not `sb-extension.json`
- `session.destroy`, not `session.stop`

The manifest adapter key `adapters.system-ui` may still exist in code for
compatibility. Treat it as a legacy key name, not a separate runtime.

## Removed Legacy Systems

The following systems are deleted and must not be used as active references:

- `src/` Node relay runtime
- `agent-core/`
- `extensions/`
- `sb-extension.json`
- `flutter_app/`

Historical documents may mention these terms, but active implementation work
must target Go Core, App UI, and `plugins/*/plugin.yaml`.

## Relay / Leaf / View

Short version:

- Relay: publicly reachable or entry/middle Core node.
- Leaf: Core node that usually connects outbound to a Relay.
- View: browser/client without Core identity.

Core manages nodes and peer trust. App UI manages browser/View sessions.
