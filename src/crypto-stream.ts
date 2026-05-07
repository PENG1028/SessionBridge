// ─── CryptoStream ──────────────────────────────────────────────
// Transparent WebSocket encryption wrapper.
//
// Wraps a raw ws:// or wss:// WebSocket and provides the same
// EventEmitter interface. All messages are automatically
// encrypted before sending and decrypted after receiving.
//
// The handshake (key exchange via hello/welcome) is initiated
// by the consumer — this class provides the session key derived
// from the exchanged public keys.
//
// Usage:
//   const cs = new CryptoStream(ws, serverIdentity);
//   await cs.handshake(clientHello, serverWelcome);
//   // From this point:
//   cs.on('message', (data) => ...);   // already decrypted
//   cs.send('{"hello":"world"}');       // auto-encrypted

import { EventEmitter } from "events";
import type WebSocket from "ws";
import {
  generateEphemeralKey,
  ecdh,
  deriveSessionKey,
  encrypt,
  decrypt,
  isEncrypted,
  type EphemeralKeyPair,
  type EncryptedPacket,
} from "./crypto-layer";
import type { NodeIdentity } from "./identity-manager";

export class CryptoStream extends EventEmitter {
  private ws: WebSocket;
  private identity: NodeIdentity;
  private _sessionKey: Buffer | null = null;
  private _eph: EphemeralKeyPair;

  constructor(ws: WebSocket, identity: NodeIdentity) {
    super();
    this.ws = ws;
    this.identity = identity;
    this._eph = generateEphemeralKey();
  }

  /** Get the ephemeral public key to include in hello/welcome. */
  get ephemeralKey(): string {
    return this._eph.publicKey;
  }

  /** Get the node's static identity public key. */
  get staticKey(): string {
    return this.identity.publicKey;
  }

  /** True after handshake() has been called and a session key is established. */
  get isEstablished(): boolean {
    return this._sessionKey !== null;
  }

  /** The derived AES-256 session key (null until handshake completes). */
  get sessionKey(): Buffer | null {
    return this._sessionKey;
  }

  /**
   * Complete the ECDH handshake once both sides have exchanged
   * their ephemeral (and optionally static) public keys.
   *
   * Two ECDH agreements:
   *   1. ephemeral-ephemeral — provides forward secrecy (always)
   *   2. static-static       — provides identity binding (if peerStaticKey provided)
   *
   * @param peerEphemeralKey  Peer's ephemeral X25519 public key (base64)
   * @param peerStaticKey     Peer's static X25519 public key (base64, optional).
   *                          Omit for browser/transient clients without persistent identity.
   */
  handshake(peerEphemeralKey: string, peerStaticKey?: string): void {
    const ephPriv = this._eph.privateKey;
    const peerEph = Buffer.from(peerEphemeralKey, "base64");

    // ECDH agreement 1: ephemeral-ephemeral — forward secrecy
    const secret1 = ecdh(ephPriv, peerEph);

    if (peerStaticKey) {
      // ECDH agreement 2: static-static — identity binding
      const identityPriv = Buffer.from(this.identity.privateKey, "base64");
      const peerStatic = Buffer.from(peerStaticKey, "base64");
      const secret2 = ecdh(identityPriv, peerStatic);
      this._sessionKey = deriveSessionKey(secret1, secret2);
    } else {
      // Only forward secrecy, no identity binding (browser clients)
      this._sessionKey = deriveSessionKey(secret1);
    }
  }

  /**
   * Send data over the encrypted channel.
   * If the session key hasn't been established yet, sends plaintext
   * (for the initial hello/welcome exchange).
   */
  send(data: string | Buffer): void {
    if (this.ws.readyState !== this.ws.OPEN) return;
    const str = typeof data === "string" ? data : data.toString("utf8");

    if (this._sessionKey) {
      const packet = encrypt(this._sessionKey, str);
      this.ws.send(JSON.stringify(packet));
    } else {
      this.ws.send(str);
    }
  }

  /**
   * Process an incoming raw WebSocket message.
   * If encrypted, decrypts it first; if plaintext, passes through.
   *
   * Call this from the WS onmessage handler instead of raw data.
   */
  processIncoming(raw: Buffer | string): void {
    const str = typeof raw === "string" ? raw : raw.toString("utf8");

    // Try to parse and check if it's an encrypted packet
    try {
      const parsed = JSON.parse(str);
      if (this._sessionKey && isEncrypted(parsed)) {
        const plaintext = decrypt(this._sessionKey, parsed);
        if (plaintext === null) {
          this.emit("error", new Error("Decryption failed — possible tampering"));
          return;
        }
        this.emit("message", plaintext);
        return;
      }
    } catch {
      // Not JSON — treat as plaintext
    }

    // Plaintext or no session key yet
    this.emit("message", str);
  }

  /** Remaining buffered data in the underlying WS send buffer. */
  get bufferedAmount(): number {
    return (this.ws as any).bufferedAmount ?? 0;
  }

  close(): void {
    this._sessionKey = null;
    this.removeAllListeners();
  }
}
