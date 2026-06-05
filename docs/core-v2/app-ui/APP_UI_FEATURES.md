# App UI Feature Map

This document lists the App UI features that should exist as first-party
control surfaces. It is a functional map, not a visual design spec.

## Dashboard

Purpose: quick health overview.

Core inputs:

- `node.*` for node and peer status
- `run.list` for active long-running work
- `plugin.list` and `plugin.check` summaries
- `logs.tail` and `audit.list` for recent events

## Node And Mesh Management

Purpose: manage Core identity, peer trust, invites, and reachability.

Required flows:

- show local identity from `node.identity.get`
- show reachable/public status from `node.reachability.check`
- create short-lived invite codes with `node.invite.create`
- accept remote invites with `node.invite.accept`
- list, reconnect, disconnect, and revoke peers with `node.peer.*`
- show clear Relay/Leaf/View language from `docs/access-model.md`

The invite and accept UI should be a dedicated dialog/card flow. It must not
pretend that a browser View is a Core peer.

## Plugin Management

Purpose: inspect, check, enable, disable, configure, and observe plugins.

Required flows:

| 流程 | 实现 | 状态 |
|------|------|------|
| list plugins | `loadApps()` from `GET /api/apps/list` (扫描 `plugins/*/plugin.yaml`) | ✅ 已实现 |
| load detail | `getManifest()` from `GET /api/apps/[appId]` | ✅ 已实现 |
| dependency/capability checks | `useDependencyCheck()` SDK hook → Core WebSocket `env.which` | ✅ 已实现 |
| show blockers by category | Dependencies tab 显示 missing/blocked；Permissions tab 显示 grant 状态 | ✅ 已实现 |
| enable/disable | `setEnabled()` SDK function → `PUT /api/apps/[appId]/state` | ✅ 已实现 |
| grant/revoke | `setGrant()` SDK function → Core WebSocket | ✅ 已实现 |
| installed software tracking | `GET/PUT /api/apps/[appId]/installed` + InstalledSoftwarePanel (Verify 按钮) | ✅ 已实现 |
| plugin detail view with Capabilities tab | PluginDetail (5 tabs) — Capabilities 按 permission 分组展示 | ✅ 已实现 |
| show approval state | `approval.list`, `notify.request`, `notify.respond` | 📋 设计阶段 |
| show runs | `run.list`, `run.info`, `run.attach`, `run.stop` | 📋 设计阶段 |
| show logs/history | `logs.query`, `plugin.history`, stream history | 📋 设计阶段 |

## Runs And Terminal

Purpose: manage long-running work independent of browser tab lifetime.

Core inputs:

- `run.create`
- `run.attach`
- `run.list`
- `run.info`
- `run.stop`
- `run.updatePolicy`
- `stream.subscribe`
- `stream.replay`
- `stream.write`

Closing a browser tab must not kill a run. Only explicit stop actions should
stop a run.

## Settings

Purpose: configure Core-facing behavior.

Settings use a right-side Drawer layout (not a full page). The panel is organized into sections:

| 区域 | 实现 | 状态 |
|------|------|------|
| Core connection and token status | `ConnectionSection` — port input, scan discovery, reconnect button | ✅ 已实现 |
| Version and connection info | `AboutSection` — UI version, Core status, port | ✅ 已实现 |
| Plugin configuration | `PluginSettingsGroup` — slot-registry-driven config forms per plugin. Reads schema from Core `plugin.config.get` | ✅ 已实现 |
| update source, policy, status, check, plan, ignore | Updates section in SettingsPanel | ✅ 已实现 |
| Core settings | `config.list` search/edit with save/reset | ✅ 已实现 |
| Slot Registry DevTools | `SlotDevTools` — debug panel (development mode only) | ✅ 已实现 |
| App UI view-session settings | — | 📋 设计阶段 |
| public access warnings | — | 📋 设计阶段 |
| logs/audit access | — | 📋 设计阶段 |

## Logs And Audit

Purpose: show operational evidence.

Core inputs:

- `logs.tail`
- `logs.query`
- `audit.list`

Logs and audit are Core facts. App UI can filter and format them, but it must
not invent events.

## Approvals

Purpose: present pending human decisions.

Core inputs:

- `approval.list`
- websocket `notify.approval.request`
- websocket `notify.approval.result`
- `notify.respond`

Approval dialogs should stay accessible globally, not only inside plugin
detail pages.
