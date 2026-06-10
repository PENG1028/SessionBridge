# SessionBridge Web

Web UI and plugin host for SessionBridge Core nodes.
Read this first. These rules are active project constraints.

## Repositories

| Repo | Purpose |
|---|---|
| `sessionbridge-core` | Go Core runtime — node, mesh, sessions, streams |
| `sessionbridge-web` | Next.js App UI + plugin host (this repo) |

Core is a standalone product. Web UI is the official first-party frontend.
They communicate through CoreClient / WebSocket / HTTP only.
The web repo does not contain Core source code.

## Runtime Boundaries

```text
app/       Next.js App UI
lib/       browser/client helpers
plugins/   plugin declarations; one plugin.yaml per plugin
docs/      design and decision records
sdk/       plugin SDK re-exports (public API surface for plugins)
```

Deleted legacy runtimes:

- `src/` old Node relay server
- `agent-core/` old extension runtime
- `extensions/` old extension directory and `sb-extension.json`
- `flutter_app/` old Flutter app
- `go-core/` extracted to `sessionbridge-core` repo

Do not reintroduce these paths.

## Canonical Concepts

Use `docs/access-model.md` as the source of truth for Relay, Leaf, and View.

- Relay: publicly reachable or entry/middle Core node.
- Leaf: Core node that usually connects outbound to a Relay.
- View: browser/client without Core identity.

Core does not manage View sessions. App UI manages View sessions.

## Current Architecture

- Go Core is the only Core runtime (separate repo: `sessionbridge-core`).
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

## Deployment

VPS has two clones:

- Core: `/home/ubuntu/sessionbridge-core/` (repo `PENG1028/sessionbridge-core`)
- Web:  `/home/ubuntu/sessionbridge-web/`  (repo `PENG1028/sessionbridge-web`)

Go Core runs via PM2 as `sessionbridge-core`; Web UI runs via PM2 as `sessionbridge-web`.

### Update VPS Core

```bash
cd /home/ubuntu/sessionbridge-core
git pull origin main
go build -o sessionnode ./cmd/node/
pm2 restart sessionbridge-core
```

### Update VPS Web

```bash
cd /home/ubuntu/sessionbridge-web
git pull origin main
npm ci
npm run build:web
pm2 restart sessionbridge-web
```

**Never upload binaries via SCP/SSH pipe.** The gzip pipe corrupts the file
when combined with other commands and pollutes the trust store (`python3` in
the same pipe reads binary from stdin). Always use git push + VPS build.

### Update PC Core

Clone and build from the Core repo:

```bash
git clone git@github.com:PENG1028/sessionbridge-core.git
cd sessionbridge-core
go build -o sessionnode.exe ./cmd/node/
./sessionnode.exe
```

### Trust Store

The VPS trust store is at `/home/ubuntu/.sessionnode/trusted_peers.json`.
Write it via a standalone Python script file (NOT an inline heredoc —
bash heredocs with Python's `True`/`False` vs JSON `true`/`false` cause
corruption). Use:

```python
python3 /path/to/script.py  # script opens and writes the file
```

### Test Mesh Forwarding

A test tool is in `sessionbridge-core/cmd/ws-test/`. Run it on VPS directly:

```bash
cd /home/ubuntu/sessionbridge-core && go run ./cmd/ws-test/
```

This connects to the local Core at `ws://127.0.0.1:9090/ws`, sends a
`node.list` request, then sends a `node.identity.get` with `targetNodeId`
pointing to the PC peer to verify mesh forwarding.

### Architecture Note: VPS has other apps (looam, nexorastack, sitesage, umami)
managed by PM2. Do not touch those.

## Development Commands

```bash
npm run dev       # Next.js dev server (connects to local Core at ws://localhost:9090/ws)
npm run dev:web   # Same as npm run dev
npm run build     # Build web (Next.js production build)
npm start         # Start Next.js production server
```

Core must be running separately. Clone and build from `sessionbridge-core`:
