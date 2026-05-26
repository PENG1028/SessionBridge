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

- list plugins from `plugin.list`
- load detail from `plugin.get`
- run dependency/capability checks through `plugin.check`
- show blockers by category: missing dependency, missing grant, unsupported
  capability, unknown capability
- enable/disable through `plugin.enable` and `plugin.disable`
- grant/revoke through `plugin.permissions.*`
- show approval state through `approval.list`, `notify.request`, and
  `notify.respond`
- show runs through `run.list`, `run.info`, `run.attach`, `run.stop`
- show logs/history through `logs.query`, `plugin.history`, and stream history

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

Required sections:

- Core connection and token status
- update source, policy, status, check, plan, ignore
- App UI view-session settings
- public access warnings
- logs/audit access

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
