# Access Model: Relay, Leaf, View

This document is canonical. If another active document conflicts with these
definitions, this document wins.

## Core Rule

Do not mix product/UI roles with Core internals.

Core manages:

- node identity
- trusted peers
- peer WebSocket connections
- capability routing and forwarding

App UI manages:

- browser/view sessions
- login state
- human-facing role labels
- pairing dialogs and connection controls

Core does not manage View sessions. A View is not a Core node.

## Canonical Definitions

| Term | Meaning | Layer |
|---|---|---|
| Core Node | A running Go Core instance with identity, trust store, and capability handlers. | Core |
| Relay | A Core node that is publicly reachable or configured as an entry/middle node for the mesh. | Product/UI label |
| Leaf | A Core node that usually cannot be reached from the public internet and connects outbound to a relay. | Product/UI label |
| View | A browser/client without Core identity. It accesses App UI and operates Core nodes through UI. | App UI |

## Relay

A Relay is a Core node that can act as a public entry or middle node.

Properties:

- has Core identity
- has `trusted_peers.json`
- may accept inbound `/peer/ws` connections
- may initiate outbound peer connections
- may forward capability requests to connected trusted peers

A Relay is not automatically a network proxy, SOCKS proxy, VPN, or TCP tunnel.
It is a control-mesh node unless a separate proxy/tunnel plugin is added.

## Leaf

A Leaf is a Core node that usually cannot be reached from the public internet.

Properties:

- has Core identity
- has `trusted_peers.json`
- usually connects outbound to a Relay
- can execute the same capabilities as any other Core node
- can run terminal, plugins, tasks, and long-running runs

Leaf is not a lower-permission role. It describes reachability, not capability.

## View

A View is a browser or client session without Core identity.

Properties:

- no Core process
- no node identity
- not stored in `trusted_peers.json`
- cannot be targeted by Core-to-Core operations
- authenticates to App UI, not directly to the mesh

Views operate nodes through:

```text
View/browser -> App UI auth -> local Core /ws -> target Core via mesh
```

## Connection Lifecycle

Core-to-Core connections are persistent trust relationships plus temporary
WebSocket sessions.

Persistent state:

- `identity.json`: local node private/public identity
- `trusted_peers.json`: trusted remote node public keys, addresses, trust policy,
  `autoReconnect`, `lastSeen`, and expiry

Runtime state:

- current `/peer/ws` connection
- reconnect loop
- stream subscriptions

Rules:

- Invite accept or reconnect sets `autoReconnect=true`.
- Disconnect keeps the trust record but sets `autoReconnect=false`.
- Revoke removes the trust record and disconnects the peer.
- Network failure does not remove trust.
- Core restart should restore peers from `trusted_peers.json` when
  `autoReconnect=true`.

## UI Rules

App UI may display Relay/Leaf/View labels, but it must derive them from actual
Core state and reachability data.

Do not:

- create fake Relay/Leaf cards from `wsUrl`
- treat a browser View as a Core node
- store View sessions in Core
- let a Relay bypass target-node permission checks

Do:

- show a View as a UI session/entry context
- show Core nodes from `node.list` / `node.peer.list`
- use `node.invite.*` and `node.peer.*` for pairing and peer lifecycle
- keep pairing UI as a UI projection over Core capabilities

## Typical Scenario

```text
Phone browser (View)
  -> App UI on VPS A
  -> Core A (Relay)
  -> Core mesh
  -> PC Core (Leaf)
  -> terminal/plugin/task execution
```

In this scenario:

- the phone is a View
- VPS A is a Relay
- the PC is a Leaf
- only Relay and Leaf are Core nodes
- the phone cannot be targeted as a Core node

## Current Implementation Notes

- Go Core is the only Core runtime.
- App UI is the first-party UI.
- `plugins/*/plugin.yaml` is the only plugin declaration source.
- Old Node relay runtime, `agent-core`, and `extensions/` have been removed.
- Mobile access currently means browser/View access unless a future mobile Core
  runtime is explicitly introduced.
