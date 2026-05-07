// ─── Crypto Layer ──────────────────────────────────────────────
// Pure functions for ECDH key exchange, HKDF session derivation,
// and AES-256-GCM encrypt/decrypt.
//
// Uses only Node.js built-in crypto module — zero dependencies.
//
// Wire format for public keys:
//   X25519 public keys are 32 raw bytes, base64-encoded for transport.
//   Ed25519 not used — X25519 handles both identity and ephemeral.

import {
  createHash,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  diffieHellman,
  createPrivateKey,
  createPublicKey,
  type KeyObject,
} from "crypto";

const IV_LENGTH = 12; // 96-bit IV for AES-256-GCM
const TAG_LENGTH = 16; // 128-bit GCM auth tag
const KEY_LENGTH = 32; // 256-bit AES key
const HKDF_INFO = Buffer.from("session-bridge-v1", "utf8");

// ─── Types ─────────────────────────────────────────────────────

export interface EphemeralKeyPair {
  /** X25519 public key — raw 32 bytes, base64-encoded */
  publicKey: string;
  /** Raw private key buffer (not exported to wire) */
  privateKey: Buffer;
}

export interface EncryptedPacket {
  [key: string]: unknown;
  enc: true;
  /** Random 12-byte IV, base64-encoded */
  iv: string;
  /** GCM auth tag (16 bytes), base64-encoded */
  tag: string;
  /** AES-256-GCM ciphertext, base64-encoded */
  data: string;
}

// ─── Key Generation ───────────────────────────────────────────

/**
 * Generate an ephemeral X25519 keypair for a single session.
 */
export function generateEphemeralKey(): EphemeralKeyPair {
  const { publicKey, privateKey } = cryptoKeygen();
  return {
    publicKey: publicKey.toString("base64"),
    privateKey,
  };
}

/** Internal: generate X25519 keypair, return raw components. */
function cryptoKeygen(): { publicKey: Buffer; privateKey: Buffer } {
  const pair = generateKeyPair();
  // Node.js v20 does not support export({ type: "raw", format: "buffer" }).
  // Extract raw key (last 32 bytes) from SPKI DER instead.
  const spkiDer = pair.publicKey.export({ type: "spki", format: "der" }) as Buffer;
  return {
    publicKey: spkiDer.subarray(spkiDer.length - 32) as Buffer,
    privateKey: pair.privateKey.export({ type: "pkcs8", format: "der" }) as Buffer,
  };
}

function generateKeyPair() {
  // Node.js types are awkward here — use any cast
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const crypto = require("crypto") as any;
  return crypto.generateKeyPairSync("x25519");
}

// ─── ECDH + HKDF ──────────────────────────────────────────────

/**
 * Perform ECDH key agreement between a local private key and
 * a remote peer's public key.
 *
 * Both keys are X25519:
 *   - privateKey: PKCS8 DER buffer (from identity manager or ephemeral)
 *   - publicKey:  raw 32-byte buffer (from hello/welcome message)
 *
 * Returns 32 bytes of shared secret.
 */
export function ecdh(privateKey: Buffer, publicKey: Buffer): Buffer {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const crypto = require("crypto") as any;
  const priv = crypto.createPrivateKey({ key: privateKey, format: "der", type: "pkcs8" });
  const pub = crypto.createPublicKey({ key: publicKey, format: "raw", type: "x25519" });
  return crypto.diffieHellman({ privateKey: priv, publicKey: pub });
}

/**
 * Derive a 32-byte AES-256 session key from one or two shared secrets
 * using HKDF-SHA256.
 *
 * @param secret1  ECDH(eph_priv, peer_eph_pub) — gives forward secrecy
 * @param secret2  ECDH(static_priv, peer_static_pub), optional — gives identity binding
 */
export function deriveSessionKey(secret1: Buffer, secret2?: Buffer): Buffer {
  const hmac = createHash("sha256");
  hmac.update(secret1);
  if (secret2) hmac.update(secret2);
  hmac.update(HKDF_INFO);
  const prk = hmac.digest();

  // Simple HKDF-Expand for a 32-byte key (one step since KEY_LENGTH <= hash_len)
  const hmac2 = createHash("sha256");
  hmac2.update(prk);
  hmac2.update(Buffer.from([0x01]));
  return hmac2.digest().subarray(0, KEY_LENGTH);
}

// ─── AES-256-GCM Encrypt / Decrypt ────────────────────────────

/**
 * Encrypt plaintext with AES-256-GCM.
 * Each call generates a fresh random IV.
 *
 * @param sessionKey  32-byte AES key
 * @param plaintext   UTF-8 string to encrypt
 * @returns           EncryptedPacket (iv + tag + data, all base64)
 */
export function encrypt(sessionKey: Buffer, plaintext: string): EncryptedPacket {
  const iv = randomBytes(IV_LENGTH);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const crypto = require("crypto") as any;
  const cipher = crypto.createCipheriv("aes-256-gcm", sessionKey, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    enc: true,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: encrypted.toString("base64"),
  };
}

/**
 * Decrypt an EncryptedPacket back to plaintext.
 * Returns null on authentication failure (tampered data).
 *
 * @param sessionKey  32-byte AES key
 * @param packet      EncryptedPacket from the wire
 * @returns           Decrypted UTF-8 string, or null if invalid
 */
export function decrypt(sessionKey: Buffer, packet: EncryptedPacket): string | null {
  try {
    const iv = Buffer.from(packet.iv, "base64");
    const tag = Buffer.from(packet.tag, "base64");
    const data = Buffer.from(packet.data, "base64");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const crypto = require("crypto") as any;
    const decipher = crypto.createDecipheriv("aes-256-gcm", sessionKey, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    return null; // auth failure or corrupt data
  }
}

/**
 * Check if a parsed message looks like an encrypted packet.
 */
export function isEncrypted(msg: Record<string, unknown>): msg is EncryptedPacket {
  return msg.enc === true && typeof msg.iv === "string" && typeof msg.tag === "string" && typeof msg.data === "string";
}

/**
 * Try to decrypt a raw WebSocket message string.
 * If it's an encrypted packet (enc:true), decrypts and returns the plaintext.
 * If it's plaintext, returns it unchanged.
 *
 * @param sessionKey  32-byte AES key, or null if crypto not established
 * @param raw         Raw WebSocket message string
 * @returns           Decrypted plaintext, or the original string if not encrypted
 */
export function tryDecrypt(sessionKey: Buffer | null, raw: string): string {
  if (!sessionKey) return raw;
  try {
    const parsed = JSON.parse(raw);
    if (isEncrypted(parsed)) {
      const result = decrypt(sessionKey, parsed);
      return result ?? raw; // fall back to raw on decrypt failure
    }
  } catch {
    // Not JSON — plaintext
  }
  return raw;
}
