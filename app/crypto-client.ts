// ─── Browser Crypto Client ─────────────────────────────────────
// Web Crypto API implementation of the ECDH + AES-256-GCM handshake.
// This is the browser equivalent of src/crypto-layer.ts.
//
// Used by the existing Web UI (lib/ws-client.ts) when the server
// supports crypto_v1. Backward-compatible: if Web Crypto doesn't
// support X25519 (older browsers), encryption is skipped and the
// connection falls back to plain WebSocket.
//
// Browser limitations vs Node.js:
//   - Identity keys are per-tab (not persisted)
//   - X25519 support requires Chrome 107+ / Firefox 114+ / Safari 16.4+

// ─── Types ─────────────────────────────────────────────────────

export interface BrowserCryptoSession {
  /** The ephemeral public key to send in hello (base64) */
  localPublicKey: string;
  /** Complete the handshake with the server's keys */
  handshake(serverStaticKey: string | undefined, serverEphemeralKey: string): Promise<void>;
  /** Whether the session key is established */
  isEstablished: boolean;
  /** Encrypt a plaintext string */
  encrypt(plaintext: string): Promise<string>;
  /** Decrypt a ciphertext JSON string. Returns null on failure. */
  decrypt(ciphertext: string): Promise<string | null>;
}

/** True if the browser supports X25519 in Web Crypto API. */
export function isX25519Supported(): boolean {
  return typeof crypto !== "undefined" &&
    typeof crypto.subtle !== "undefined" &&
    typeof crypto.subtle.generateKey === "function";
}

/**
 * Create a browser crypto session for a single WebSocket connection.
 * Generates an ephemeral X25519 keypair.
 */
export async function createCryptoSession(): Promise<BrowserCryptoSession | null> {
  if (!isX25519Supported()) return null;

  try {
    // Generate X25519 keypair
    const keyPair = await (crypto.subtle.generateKey as any)(
      { name: "X25519" },
      true,
      ["deriveBits"],
    ) as CryptoKeyPair;

    // Export public key
    const rawPub = await crypto.subtle.exportKey("raw", keyPair.publicKey);
    const localPublicKey = btoa(String.fromCharCode(...new Uint8Array(rawPub)));

    let sessionKey: CryptoKey | null = null;
    let established = false;

    return {
      localPublicKey,

      get isEstablished(): boolean {
        return established;
      },

      async handshake(serverStaticKey: string | undefined, serverEphemeralKey: string): Promise<void> {
        // Import server ephemeral key (always present)
        const srvEph = await importX25519Pub(serverEphemeralKey);

        // Derive shared bits via ECDH
        const shared1 = await deriveBits(keyPair.privateKey, srvEph);

        if (serverStaticKey) {
          // Full handshake: ephemeral-ephemeral + ephemeral-static (no static key on browser side)
          const srvStatic = await importX25519Pub(serverStaticKey);
          const shared2 = await deriveBits(keyPair.privateKey, srvStatic);
          const combined = new Uint8Array(shared1.byteLength + shared2.byteLength);
          combined.set(new Uint8Array(shared1), 0);
          combined.set(new Uint8Array(shared2), shared1.byteLength);
          sessionKey = await deriveHkdf(combined.buffer as ArrayBuffer);
        } else {
          // Forward secrecy only (no identity binding)
          sessionKey = await deriveHkdf(shared1);
        }
        established = true;
      },

      async encrypt(plaintext: string): Promise<string> {
        if (!sessionKey || !established) return plaintext;
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encoded = new TextEncoder().encode(plaintext);
        const encrypted = await crypto.subtle.encrypt(
          { name: "AES-GCM", iv },
          sessionKey,
          encoded,
        );

        // encrypted = ciphertext + GCM tag (last 16 bytes)
        const ciphertext = new Uint8Array(encrypted.slice(0, encrypted.byteLength - 16));
        const tag = new Uint8Array(encrypted.slice(encrypted.byteLength - 16));

        return JSON.stringify({
          enc: true,
          iv: btoa(String.fromCharCode(...iv)),
          tag: btoa(String.fromCharCode(...tag)),
          data: btoa(String.fromCharCode(...ciphertext)),
        });
      },

      async decrypt(ciphertext: string): Promise<string | null> {
        if (!sessionKey || !established) return ciphertext;
        try {
          const parsed = JSON.parse(ciphertext);
          if (!parsed.enc) return ciphertext;

          const iv = Uint8Array.from(atob(parsed.iv), (c) => c.charCodeAt(0));
          const tag = Uint8Array.from(atob(parsed.tag), (c) => c.charCodeAt(0));
          const data = Uint8Array.from(atob(parsed.data), (c) => c.charCodeAt(0));

          // Append tag to ciphertext (Web Crypto API expects them together)
          const combined = new Uint8Array(data.length + tag.length);
          combined.set(data, 0);
          combined.set(tag, data.length);

          const decrypted = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv },
            sessionKey,
            combined,
          );
          return new TextDecoder().decode(decrypted);
        } catch {
          return null;
        }
      },
    };
  } catch {
    return null;
  }
}

// ─── Helpers ───────────────────────────────────────────────────

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) { result.set(a, offset); offset += a.length; }
  return result;
}

async function importX25519Pub(base64Key: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(base64Key), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "raw",
    raw,
    { name: "X25519" },
    true,
    [],
  );
}

async function deriveBits(privateKey: CryptoKey, publicKey: CryptoKey): Promise<ArrayBuffer> {
  return crypto.subtle.deriveBits(
    { name: "X25519", public: publicKey },
    privateKey,
    256,
  );
}

/**
 * HKDF-SHA256 to derive a 32-byte AES-256-GCM key from one or two shared secrets.
 * Matches deriveSessionKey() in src/crypto-layer.ts.
 */
async function deriveHkdf(sharedSecret: ArrayBuffer): Promise<CryptoKey> {
  const hash = await crypto.subtle.digest("SHA-256", sharedSecret);
  const info = new TextEncoder().encode("session-bridge-v1");
  const input = concat(new Uint8Array(hash), info, new Uint8Array([0x01]));
  const finalHash = await crypto.subtle.digest("SHA-256", input as unknown as ArrayBuffer);
  return crypto.subtle.importKey(
    "raw",
    finalHash.slice(0, 32) as ArrayBuffer,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}
