# Full Working Network Scenario -- Mesh Security Acceptance

## Scenario: Two-Node Mesh Over LAN

### Setup
1. Start Node A (relay-capable, port 9090)
2. Start Node B (leaf, port 9091)
3. Both generate identities on first startup (persisted to identity.json with 0600 permissions)
4. On restart, identities are reloaded and validated (key lengths, key-pair match, fingerprint verification)

### Pairing
5. Node A creates invite: `node.invite.create { ttlSeconds: 300 }`
6. Node B accepts: `node.invite.accept { peerUrl: "ws://localhost:9090/peer/ws", code: "..." }`
7. Trust records written on both sides

### Connection
8. Node B connects to Node A via /peer/ws with full handshake
9. `node.peer.list` shows peer status "connected"

### Session Forwarding
10. Client on Node B creates a shell session targeting Node A
11. Session runs on Node A, output forwarded back to Node B

### Reconnection
12. Kill Node A process
13. Node B peer status changes to "disconnected"
14. Restart Node A
15. Node B auto-reconnects with backoff
16. Peer status returns to "connected"

### Trust Revocation
17. Node B revokes Node A trust: `node.peer.revoke { nodeId: "..." }`
18. Node A can no longer connect via /peer/ws
19. `node.peer.list` shows Node A as "revoked"

### Security Verifications
20. Raw /ws connection with actorType=node -> rejected
21. /peer/ws connection without handshake -> rejected
22. /peer/ws with wrong signature -> rejected
23. /peer/ws with expired trust -> rejected
