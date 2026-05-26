# App UI API Map

This file lists the Core capabilities App UI is allowed to call directly.
Feature-specific behavior still belongs to the feature plugin or to Go Core.

## Connection

| API / Event | Direction | Used By | Notes |
| --- | --- | --- | --- |
| `/ws` | App UI -> Core | CoreClient | Requires token when Core is publicly bound |
| `connectionStatus` | CoreClient event | App shell, overlays | Local UI event, not a Core capability |
| `connected` | CoreClient event | terminal/run recovery | Re-subscribe and replay after reconnect |

## Node And Mesh

| Capability | Used By | Purpose |
| --- | --- | --- |
| `node.identity.get` | Node/Mesh page | Show local Core identity |
| `node.reachability.check` | Node/Mesh page, Settings | Show whether this Core can act as a reachable Relay |
| `node.invite.create` | Pairing dialog | Generate short-lived invite code |
| `node.invite.list` | Pairing dialog | Show pending invites |
| `node.invite.revoke` | Pairing dialog | Revoke unused invite |
| `node.invite.accept` | Pairing dialog | Accept remote Core invite and establish trust |
| `node.peer.list` | Node/Mesh page | Show trusted peers |
| `node.peer.info` | Node/Mesh page | Show peer details |
| `node.peer.reconnect` | Node/Mesh page | Ask Core to reconnect a peer |
| `node.peer.disconnect` | Node/Mesh page | Disconnect without deleting trust |
| `node.peer.revoke` | Node/Mesh page | Remove trust |

App UI may label nodes as Relay or Leaf for user understanding. Core only
stores peers and trust.

## Plugins

| Capability | Used By | Purpose |
| --- | --- | --- |
| `plugin.list` | Plugin Manager | List installed plugins |
| `plugin.get` | Plugin Detail, registry sync | Load full manifest and adapter declarations |
| `plugin.check` | Plugin Manager, Plugin Detail | Dependency, capability, and permission blocker report |
| `plugin.enable` | Plugin Manager | Enable plugin |
| `plugin.disable` | Plugin Manager | Disable plugin |
| `plugin.permissions.grant` | Plugin Detail | Grant a declared capability |
| `plugin.permissions.revoke` | Plugin Detail | Revoke a declared capability |
| `plugin.config.set` | Plugin Detail, host components | Set one config key/value at a time |
| `plugin.history` | Plugin Detail | Show plugin events |
| `plugin.cache.info` | Plugin Detail | Inspect plugin cache |
| `plugin.cache.clear.plan` | Plugin Detail | Plan cache clear |
| `plugin.cache.clear.execute` | Plugin Detail | Execute cache clear plan |
| `plugin.install.plan` | Plugin Detail | Plan install actions |
| `plugin.install.execute` | Plugin Detail | Execute install when implemented by Core |
| `plugin.uninstall` | Plugin Detail | Uninstall when implemented by Core |

## Runs, Sessions, Streams

| Capability | Used By | Purpose |
| --- | --- | --- |
| `run.create` | Terminal/plugin launch | Create durable long-running work |
| `run.attach` | Terminal recovery, Runs tab | Attach metadata to an existing run |
| `run.list` | Terminal dropdown, Plugin Detail | List active/history runs |
| `run.info` | Runs tab | Inspect one run |
| `run.stop` | Terminal, Runs tab | Explicitly stop a run |
| `run.updatePolicy` | Future settings | Change run policy |
| `session.list` | Sessions page | List sessions |
| `session.get` | Sessions page | Inspect session |
| `session.destroy` | Sessions page | Destroy session |
| `stream.subscribe` | Terminal/Sessions | Subscribe to live stdout/stderr |
| `stream.replay` | Terminal/Sessions | Replay history by sequence |
| `stream.tail` | Sessions | Tail recent stream output |
| `stream.write` | Terminal/Sessions | Write stdin |

Do not use `session.stop`; the implemented capability is `session.destroy`.

## Approvals And Notifications

| API / Event | Used By | Purpose |
| --- | --- | --- |
| `approval.list` | Approval overlay, Approvals page | Hydrate pending approvals |
| `notify.request` | Plugin workflows | Ask for human approval |
| `notify.respond` | Approval overlay, Plugin Detail | Approve or deny |
| websocket `notify.approval.request` | Approval overlay | Push new approval request |
| websocket `notify.approval.result` | Approval overlay | Remove completed request |

There is no active `approval.approve`, `approval.deny`, `approval.get`,
`approval.takeOver`, or `approval.viewing` capability.

## Logs And Audit

| Capability | Used By | Purpose |
| --- | --- | --- |
| `logs.tail` | Logs page | Recent log lines |
| `logs.query` | Logs page, Plugin Detail | Filtered log entries |
| `audit.list` | Logs/Audit page | Audit trail |

## Update

| Capability | Used By | Purpose |
| --- | --- | --- |
| `update.status` | Settings | Current update state |
| `update.source.get` | Settings | Read update source |
| `update.source.set` | Settings | Change update source |
| `update.policy.get` | Settings | Read update policy |
| `update.policy.set` | Settings | Change update policy |
| `update.check` | Settings | Read-only remote check |
| `update.plan` | Settings | Plan update and blockers |
| `update.ignore` | Settings | Ignore one remote version |

`update.apply` is intentionally not registered.

## Public Access Boundary

App UI view login/session APIs are product/UI concerns. They are not Core mesh
capabilities. If implemented as server routes, document them separately from
Core capability names.
