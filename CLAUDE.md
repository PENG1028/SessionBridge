# SessionBridge Agent Rules

Read this first. These rules are active project constraints.

## Runtime Boundaries

```text
go-core/   Go Core runtime and mesh/control plane
app/       Next.js App UI
lib/       browser/client helpers
plugins/   plugin declarations; one plugin.yaml per plugin
docs/      design and decision records
```

Deleted legacy runtimes:

- `src/` old Node relay server
- `agent-core/` old extension runtime
- `extensions/` old extension directory and `sb-extension.json`
- `flutter_app/` old Flutter app

Do not reintroduce these paths.

## Canonical Concepts

Use `docs/access-model.md` as the source of truth for Relay, Leaf, and View.

- Relay: publicly reachable or entry/middle Core node.
- Leaf: Core node that usually connects outbound to a Relay.
- View: browser/client without Core identity.

Core does not manage View sessions. App UI manages View sessions.

## Current Architecture

- Go Core is the only Core runtime.
- App UI is the first-party UI.
- App UI talks to Go Core through CoreClient / WebSocket / HTTP only.
- App UI must not import Go server code.
- Core-to-Core mesh uses identity, trust store, invite pairing, and `/peer/ws`.
- Browser/View access is a separate App UI auth layer.

## Plugin Rules

`plugins/*/plugin.yaml` is the only plugin declaration source.

Plugin contributions must be declared in `plugin.yaml`:

- views/panels through manifest contributions
- commands through manifest contributions
- configuration through manifest contributions
- Core capabilities through manifest permissions

Do not add a second plugin declaration system.

## Naming Rules

- Use App UI, not System UI, for the current first-party UI.
- `adapters.system-ui` may still exist as a manifest key if code requires it,
  but prose should explain it as a legacy key name, not a separate runtime.
- Use `session.destroy`; do not introduce new `session.stop` call sites.
- Use Core node for mesh participants; View is not a node.

## Security Rules

- `/ws` is for App UI/control clients and uses `SESSIONNODE_TOKEN` when exposed.
- `/peer/ws` is for Core-to-Core mesh and uses ed25519 trust.
- `/peer/invite/accept` is for one-time pairing codes.
- Do not log or render raw Core tokens.
- A Relay must not bypass permission checks on the target Core.

## Development Commands

```bash
npm run dev       # Go Core + Next.js dev
npm run dev:core  # Go Core only
npm run dev:web   # Next.js only
npm run build     # build web + Go Core
npm start         # start Go Core
```

If Go build cache fails on Windows, use:

```powershell
$env:GOCACHE='F:\Work Document\project\sessionBridge\go-core\.gocache'
```
