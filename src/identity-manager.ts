// ─── Node Identity Manager ─────────────────────────────────────
// Each node generates an X25519 keypair on first start.
// The public key serves as the node's cryptographic identity
// during ECDH handshake, binding every session to a known node.
//
// Stored at ~/.sessionbridge/identity.json
// Auto-generated, zero configuration.

import { generateKeyPairSync, randomBytes } from "crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

export interface NodeIdentity {
  nodeId: string;
  /** X25519 public key — raw 32 bytes, base64-encoded */
  publicKey: string;
  /** X25519 private key — PKCS8 DER, base64-encoded */
  privateKey: string;
}

const DEFAULT_PATH = join(homedir(), ".sessionbridge", "identity.json");

/**
 * Load an existing identity from disk, or generate a new one.
 * This is called once at startup.
 */
export function loadOrCreateIdentity(filePath?: string): NodeIdentity {
  const path = filePath || DEFAULT_PATH;

  if (existsSync(path)) {
    try {
      const raw = readFileSync(path, "utf8");
      return JSON.parse(raw) as NodeIdentity;
    } catch {
      // Corrupt file — regenerate
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const crypto = require("crypto") as any;
  const pair = crypto.generateKeyPairSync("x25519");
  // Node.js v20 does not support export({ type: "raw", format: "buffer" }).
  // Extract raw key (last 32 bytes) from SPKI DER instead.
  const spkiDer = pair.publicKey.export({ type: "spki", format: "der" }) as Buffer;
  const publicKey = spkiDer.subarray(spkiDer.length - 32) as Buffer;
  const privateKey = pair.privateKey.export({ type: "pkcs8", format: "der" }) as Buffer;

  const identity: NodeIdentity = {
    nodeId: Array.from(randomBytes(16))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(""),
    publicKey: publicKey.toString("base64"),
    privateKey: privateKey.toString("base64"),
  };

  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(identity, null, 2), "utf8");

  return identity;
}
