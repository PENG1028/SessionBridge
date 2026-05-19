# Core Legacy Archive - 2026-05-19

This directory is a frozen snapshot of the pre-core-v2 runtime, sync, tab,
surface, operation, and related documentation model.

It is archived for reference only. Do not treat files in this directory as the
authoritative design for future work.

## Why This Exists

The previous core model mixed several responsibilities that should be separated
in the next design:

- machine identity, node labels, IP addresses, and `__local__`
- terminal/session lifetime and UI tab lifetime
- `SharedSurface` state and `workbench.tabs` compatibility state
- local API creation paths and cross-relay publish paths
- runtime command execution and UI operation replay
- browser-local persistence and multi-node synchronized state

This made tab synchronization hard to reason about because there was no single
clean source of truth for "what session exists, on which node, and how it should
appear in every browser."

## Archived Content

The snapshot keeps old core-level materials under their original relative paths:

- `docs/`: architecture, protocol, API, terminology, surface replay, operation,
  runtime, and sync documentation
- `src/`: relay server, API routes, instance manager, remote operation manager,
  persistence, state bridge, and configuration code
- `agent-core/`: previous agent/core runtime package
- `extensions/`: extension protocol, registry, shell, and Claude Code adapters
- `app/` and `lib/`: UI bridge pieces that were coupled to the old core model
- `tests/`: integration, e2e, and spec files related to the old behavior

Generated test result artifacts are intentionally not archived here.

## Legacy Concepts Frozen Here

These names may still be useful for understanding existing code, but they should
not be copied into the next design without being redefined:

- `Instance`
- `SharedSurface`
- `StateBridge`
- `workbench.tabs`
- `surface.publish`
- `surface.subscribeNode`
- `workbench.subscribe`
- `remote.operation`
- `runtime.*`
- `operation.*`
- `shell.*`
- `__local__`

## Next Design Direction

The next authoritative core design should live outside this archive, preferably
under `docs/core-v2/`.

Recommended rule for the next design:

One durable session model should be the source of truth. Tabs should be only a UI
projection of sessions, not an independent synchronized state model.

