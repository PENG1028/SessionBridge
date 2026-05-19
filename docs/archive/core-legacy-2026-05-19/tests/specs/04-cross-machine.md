# 04 — Cross-Machine Tests

End-to-end tests across real network: local machine ↔ VPS relay via SSH tunnel.
These are the closest to production conditions.

## Topology

```
Local Machine ──(SSH tunnel :18080)──→ VPS Relay (:8080)
                         │
                         └── Local Relay (:14400) ← upstream VPS
```

## Prerequisites

- VPS relay running on port 8080
- SSH tunnel: `ssh -L 18080:127.0.0.1:8080 user@vps`
- Local relay on port 14400 with `--upstream ws://localhost:18080`

## Tests

### 1. `cross-machine-vps-e2e.test.mjs`
Tab lifecycle, terminal output, surface sync across real SSH tunnel.

### 2. `cross-machine-full-matrix.test.mjs`
**47 scenarios** across Terminal / Surface / Workbench / Node / Filesystem / Reconnect / Concurrency / Boundary categories. The most comprehensive cross-machine test.

### 3. `two-node-vps-tab-sync.test.mjs`
Tab created on Node A (VPS) syncs to Node B (local). Real-world bug reproduction.

### 4. `vps-tab-sync.test.mjs`
Earlier VPS tab sync test — workbench.tabs propagation through VPS relay.
