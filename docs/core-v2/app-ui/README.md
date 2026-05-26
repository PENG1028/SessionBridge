# App UI Documentation

This directory documents the current first-party App UI. If another active
document conflicts with this file, this file wins.

## Current Names

Use these terms in new docs and code reviews:

| Use | Do Not Use |
| --- | --- |
| App UI | System UI |
| Go Core | Node relay runtime |
| plugin | extension |
| `plugin.yaml` | `sb-extension.json` |
| `session.destroy` | `session.stop` |
| View | Core node |

The manifest adapter key may still be named `adapters.system-ui` for wire
compatibility. Treat that as a schema key, not as the product name.

## What App UI Owns

App UI is the first-party control surface for Go Core. It owns browser-facing
state and interaction:

- view login sessions and session lifetime
- tabs, panes, layout, selected views, collapsed panels
- mesh pairing dialogs and human-readable peer labels
- approval overlays and notification display
- plugin management pages and user workflows
- settings pages that call Core capabilities

App UI does not own Core facts. It must query Core for runs, sessions,
plugins, peer trust, update status, logs, audit entries, and capability
results.

## What Go Core Owns

Go Core owns durable machine state and all cross-device operations:

- node identity and trust store
- Core-to-Core peer connections through `/peer/ws`
- invite creation and invite acceptance
- capability dispatch and permission checks
- plugin manifests and capability declarations
- runs, processes, streams, history, logs, audit
- update source, update policy, update checks, update plans

App UI must call Core for these operations. It must not reimplement peer
pairing, process tracking, plugin checks, or update planning in browser state.

## Relay, Leaf, View

Relay, Leaf, and View are product/UI classifications:

- **Relay**: a Core node with a reachable public address. Other nodes can
  connect to it.
- **Leaf**: a Core node that may only be able to dial out. It can stay
  connected to a Relay and be controlled through the mesh.
- **View**: a browser or app with no Core process. It controls the mesh through
  App UI -> local Core -> target Core.

Core itself only sees nodes and peers. A View is not a node, has no mesh
identity, and never connects to `/peer/ws`.

See [Access Model](../../access-model.md) for the canonical definitions.

## Main Integration Path

The active UI integration path is:

```text
plugins/*/plugin.yaml
  -> Go Core plugin manifest loader
  -> plugin.list / plugin.get
  -> App UI CoreClient
  -> useCorePluginRegistrySync
  -> App registries and PluginManifestViewRenderer
```

There is no active `extensions/` runtime and no `sb-extension.json` manifest.

## Important Files

| File | Purpose |
| --- | --- |
| [APP_UI_PLUGIN.md](APP_UI_PLUGIN.md) | App UI responsibilities and boundaries |
| [APP_UI_API_MAP.md](APP_UI_API_MAP.md) | UI-to-Core capability map |
| [UX_SURFACES.md](UX_SURFACES.md) | Surface and layout model |
| [PLUGIN_HOST.md](PLUGIN_HOST.md) | How plugin-declared UI contributions are rendered |
| [wireframes/](wireframes/) | Page-level layouts and interaction notes |

Historical files whose names start with `SYSTEM_UI_` are compatibility stubs
or migration notes. Do not use them as the source of truth.
