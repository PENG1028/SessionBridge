# Full Working Network Scenario -- Mesh Security Acceptance

## Scenario: Two-Node Mesh Over LAN

### Setup
1. Start Node A (relay-capable, port 9090)
2. Start Node B (leaf, port 9091)
3. Both generate identities on first startup

### Pairing
4. Node A creates invite: `node.invite.create { ttlSeconds: 300 }`
5. Node B accepts: `node.invite.accept { peerUrl: "ws://localhost:9090/peer/ws", code: "..." }`
6. Trust records written on both sides

### Connection
7. Node B connects to Node A via /peer/ws with full handshake
8. `node.peer.list` shows peer status "connected"

### Session Forwarding
9. Client on Node B creates a shell session targeting Node A
10. Session runs on Node A, output forwarded back to Node B

### Reconnection
11. Kill Node A process
12. Node B peer status changes to "disconnected"
13. Restart Node A
14. Node B auto-reconnects with backoff
15. Peer status returns to "connected"

### Trust Revocation
16. Node B revokes Node A trust: `node.peer.revoke { nodeId: "..." }`
17. Node A can no longer connect via /peer/ws
18. `node.peer.list` shows Node A as "revoked"

### Security Verifications
19. Raw /ws connection with actorType=node -> rejected
20. /peer/ws connection without handshake -> rejected
21. /peer/ws with wrong signature -> rejected
22. /peer/ws with expired trust -> rejected
