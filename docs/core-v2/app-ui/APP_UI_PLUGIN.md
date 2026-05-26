# App UI Plugin Contract

This document defines the current App UI boundary. Older files may still use
the former name for migration history only.

## Definition

App UI is the first-party browser control surface shipped with SessionBridge.
It is not a Core node and it is not a feature plugin. It is a trusted UI client
that talks to Go Core through the same Core protocol used by other clients.

```text
Browser / View
  -> App UI
  -> CoreClient
  -> Go Core `/ws`
  -> capability dispatcher
  -> local or remote Core node
```

For cross-device operations, App UI still calls the local Core first:

```text
View browser
  -> public App UI
  -> local Relay Core
  -> peer mesh
  -> target Leaf Core
```

## Responsibilities

App UI owns:

- first-use UI login and view sessions
- remembering browser sessions and auto-login duration
- page routing, tabs, panes, layout, and view projection
- plugin management workflow and human-readable status
- pairing and invite dialogs for Core mesh operations
- approval, notification, settings, logs, and audit presentation

Go Core owns:

- the security token required by `/ws`
- node identity and peer trust
- invite codes and peer acceptance
- durable peer reconnection
- capability dispatch, permission checks, and audit
- plugin manifests, plugin checks, runs, sessions, streams, history

## Non-Goals

App UI must not:

- create its own mesh protocol
- store Core peers as browser-only state
- bypass Core permission or audit paths
- treat a View as a Core node
- make plugin capability decisions without `plugin.check`
- keep run/session/process truth in localStorage
- reintroduce `extensions/`, `sb-extension.json`, or relay extension points

## Public Access Model

When App UI is reachable from a non-local address, it must enforce an App UI
login flow. That login is a UI/view concept and is separate from Core-to-Core
mesh trust.

Expected product behavior:

1. If no UI password/session secret exists on first public access, the first
   visitor must create it.
2. After login, the browser receives a View session.
3. View sessions are managed by App UI and default to one day unless configured
   otherwise.
4. App UI uses its configured Core token to call the local Core.
5. Core never sees View users as mesh peers.

## Mesh Pairing UI

The UI for connecting two Core nodes must call Core capabilities:

- `node.identity.get`
- `node.invite.create`
- `node.invite.accept`
- `node.invite.list`
- `node.invite.revoke`
- `node.peer.list`
- `node.peer.info`
- `node.peer.reconnect`
- `node.peer.disconnect`
- `node.peer.revoke`
- `node.reachability.check`

The UI may show cards, dialogs, QR codes, copy buttons, and confirmation
prompts, but the durable result must come from Core trust store changes.

## Plugin UI Contributions

Plugin UI declarations come from the same `plugin.yaml` as Core declarations.
App UI reads them through `plugin.list` and `plugin.get`, then registers the
declared views, panels, commands, and status slots.

Supported rendering modes:

- `host-rendered`: App UI renders a known host component by `componentId`.
- `custom-react`: reserved; currently renders a not-implemented placeholder.

Do not add a second manifest location for first-party plugins.
