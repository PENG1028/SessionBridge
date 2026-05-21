# Public Core Mesh Security Baseline

## 1. Core / UI / View Concept Boundaries

- **Core** only recognizes **nodes**. A node is any process running the Go Core binary with a cryptographic identity.
- **Relay**, **Leaf**, **View** are UI/product-layer classifications, NOT Core-level concepts.
- A **View** is a browser or mobile app that connects to Core via control WS. Views do NOT have Core identities.
- If a mobile device runs Go Core, it IS a node. If it only browses the UI, it is a View.
- Core does NOT implement user/team/role permissions.

## 2. Endpoint Architecture

### Control WS (`/ws`)
- Purpose: UI clients, local tools, browser panels
- Actor type: always "web" (set server-side, not from client)
- **Client-supplied `actorType=node` is BLOCKED** -- returns ACTOR_TYPE_NODE_BLOCKED
- Authentication: SESSIONNODE_TOKEN (or dev mode -- no token)

### Peer WS (`/peer/ws`)
- Purpose: Core-to-Core mesh connections
- Actor type: always "node" (set server-side after handshake)
- Requires full peer handshake (see Section 3)
- Uses ed25519 identity + trust store for authentication

## 3. Peer Handshake Protocol

1. Client -> Server: `peer.hello` { nodeId, publicKey, fingerprint, timestamp }
2. Server validates against trust store (unknown/expired/revoked -> reject)
3. Server -> Client: `peer.challenge` { requestId, nonce }
4. Client signs nonce with private key -> Server: `peer.response` { requestId, signature }
5. Server verifies signature -> Server -> Client: `peer.welcome` { nodeId }
6. Connection established -- all subsequent messages trusted as node-to-node

## 4. Identity & Trust

### Node Identity
- Generated on first startup: `~/.sessionnode/identity.json`
- ed25519 key pair (stdlib crypto/ed25519)
- Private key is persisted to identity.json alongside the public key (file permissions 0600)
- Private key is NEVER returned by API, NEVER appears in logs
- On restart, the loaded identity is validated (key lengths, key-pair consistency, fingerprint match)
- Fingerprint: SHA-256 of public key (hex)
- NodeID defaults to first 12 hex chars of fingerprint

### Trust Store
- Persisted: `~/.sessionnode/trusted_peers.json`
- Each entry: nodeId, name, publicKey, fingerprint, addresses, trustExpiresAt, autoReconnect, policy
- Policy mode: "full" only (reserved for future expansion)
- Trust is MUTUAL -- both nodes must trust each other

## 5. Invite Pairing Flow

1. Node A creates invite: `node.invite.create` -> returns short-lived code (60s default, max 10m)
2. Node A shares code with Node B (out of band -- QR, copy-paste, etc.)
3. Node B accepts: `node.invite.accept` { peerUrl, code }
4. Node A validates code -> exchanges identities
5. Both nodes add each other to trust store
6. Nodes establish persistent peer WS connection with handshake

**Invite code is a bootstrap mechanism, NOT a long-term credential.** After pairing, nodes authenticate via ed25519 identity.

## 6. Automatic Reconnection

- `autoReconnect: true` peers are automatically connected at startup
- Exponential backoff: 1s -> 2s -> 4s -> ... -> 30s max
- Jitter applied to prevent thundering herd
- Reconnection is fully autonomous -- no UI required

## 7. Security Guarantees

| Threat | Mitigation |
|--------|-----------|
| Spoofed actorType=node on /ws | Blocked -- server rejects client-supplied actorType=node |
| Unauthenticated peer connection | /peer/ws requires challenge-response handshake |
| Replay attack on handshake | Timestamp check with small window |
| Private key theft | Key stored with 0600 permissions on disk, never in API responses |
| Rogue node impersonation | Trust store validates public key fingerprint |
| Invite code replay | Single-use code, expired after TTL |
| Trust expiration | Expired peers rejected during handshake |

## 8. What Is NOT Implemented

- Per-node capability matrix
- User/team/view permissions
- QR code generation (product layer concern)
- NAT traversal / STUN
- mTLS (ws:// non-localhost is dev/insecure; wss:// is supported but not enforced)
- Per-peer policy modes beyond "full"
- Invite approval workflow (join.request/approve)
- Product role model (Relay/Leaf/View)

## 9. UI Integration (Future)

UI pages will call these Core capabilities:
- `node.identity.get` -- display local node identity
- `node.invite.create` -- generate invite code for pairing
- `node.invite.accept` -- accept invite from another node
- `node.peer.list` -- show mesh topology
- `node.peer.revoke` -- remove untrusted peer
- `node.peer.reconnect` -- force reconnection attempt
