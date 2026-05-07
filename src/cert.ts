// ─── Auto-Generated Self-Signed Certificate ───────────────────────
// SessionBridge generates its own TLS cert on first start.
// No nginx, no Let's Encrypt, no external tools needed.
//
// The browser will show "Not Secure" on first visit — click through.
// Traffic is encrypted from that point on.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { homedir } from "os";

export interface CertPaths {
  key: string;
  cert: string;
}

const CONFIG_DIR = join(homedir(), ".sessionbridge");
const KEY_PATH = join(CONFIG_DIR, "key.pem");
const CERT_PATH = join(CONFIG_DIR, "cert.pem");

/**
 * Ensure a self-signed cert exists. Returns paths to key + cert files.
 * Generates one on first call if missing.
 */
export function ensureCert(): CertPaths | null {
  if (existsSync(KEY_PATH) && existsSync(CERT_PATH)) {
    return { key: KEY_PATH, cert: CERT_PATH };
  }

  console.log("\n  🔐 Generating self-signed certificate...");

  try {
    mkdirSync(CONFIG_DIR, { recursive: true });

    // Try openssl first (available on Linux, macOS, Windows Git Bash)
    execSync(
      `openssl req -x509 -newkey rsa:2048 -nodes ` +
      `-keyout "${KEY_PATH}" -out "${CERT_PATH}" ` +
      `-days 3650 -subj "/CN=SessionBridge" 2>&1`,
      { stdio: "pipe", timeout: 15000, windowsHide: true },
    );

    console.log("  ✓ Certificate generated at ~/.sessionbridge/");
    console.log("  ℹ  Browser will show a warning on first visit — this is expected.\n");
    return { key: KEY_PATH, cert: CERT_PATH };
  } catch (err) {
    // Fallback: try Node.js crypto (no openssl dependency)
    console.log("  ⚠ openssl not available, trying Node.js crypto fallback...");

    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const crypto = require("crypto");

      // Generate RSA key pair
      const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
        modulusLength: 2048,
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
      });

      // Build a self-signed X.509 v3 certificate using DER encoding
      const certPem = buildSelfSignedCert(publicKey, privateKey);

      writeFileSync(KEY_PATH, privateKey, "utf-8");
      writeFileSync(CERT_PATH, certPem, "utf-8");

      console.log("  ✓ Certificate generated via Node.js crypto fallback");
      return { key: KEY_PATH, cert: CERT_PATH };
    } catch (fallbackErr) {
      console.error(`  ✗ Failed to generate certificate: ${(fallbackErr as Error).message}`);
      console.error("  Continuing with HTTP (no encryption) — set BRIDGE_SSL_KEY/BRIDGE_SSL_CERT manually.");
      return null;
    }
  }
}

/**
 * Build a self-signed X.509 v3 certificate using Node.js crypto primitives.
 * Uses manual DER/ASN.1 encoding since Node lacks a high-level cert builder.
 */
function buildSelfSignedCert(publicKeyPem: string, privateKeyPem: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const crypto = require("crypto");

  // ─── DER Encoding Primitives ─────────────────────────────

  function derLength(length: number): Buffer {
    if (length < 0x80) return Buffer.from([length]);
    const bytes: number[] = [];
    let len = length;
    while (len > 0) { bytes.unshift(len & 0xFF); len >>>= 8; }
    return Buffer.from([0x80 | bytes.length, ...bytes]);
  }

  function derTag(tag: number, content: Buffer): Buffer {
    return Buffer.concat([Buffer.from([tag]), derLength(content.length), content]);
  }

  function derSequence(contents: Buffer[]): Buffer {
    return derTag(0x30, Buffer.concat(contents));
  }

  function derSet(contents: Buffer[]): Buffer {
    return derTag(0x31, Buffer.concat(contents));
  }

  function derInteger(value: number): Buffer {
    const hex = value.toString(16);
    const bytes = Buffer.from(hex.length % 2 ? "0" + hex : hex, "hex");
    if (bytes[0] & 0x80) {
      return derTag(0x02, Buffer.concat([Buffer.from([0x00]), bytes]));
    }
    return derTag(0x02, bytes);
  }

  function derOID(oid: string): Buffer {
    const parts = oid.split(".").map(Number);
    const bytes: number[] = [parts[0] * 40 + parts[1]];
    for (let i = 2; i < parts.length; i++) {
      let v = parts[i];
      if (v < 0x80) { bytes.push(v); continue; }
      const stack: number[] = [];
      while (v > 0) { stack.push(v & 0x7F); v >>>= 7; }
      while (stack.length > 0) {
        const b = stack.pop()!;
        bytes.push(stack.length > 0 ? (b | 0x80) : b);
      }
    }
    return derTag(0x06, Buffer.from(bytes));
  }

  function derBitString(content: Buffer): Buffer {
    return derTag(0x03, Buffer.concat([Buffer.from([0x00]), content]));
  }

  function derOctetString(content: Buffer): Buffer {
    return derTag(0x04, content);
  }

  function derNull(): Buffer {
    return Buffer.from([0x05, 0x00]);
  }

  function derUTCTime(date: Date): Buffer {
    const iso = date.toISOString();
    const parts = iso.split(/[-T:.Z]/);
    const formatted = parts[0].slice(2) + parts[1] + parts[2] + parts[3] + parts[4] + parts[5] + "Z";
    return derTag(0x17, Buffer.from(formatted));
  }

  /** Context-specific explicit tag: [tag] EXPLICIT */
  function derExplicit(tag: number, content: Buffer): Buffer {
    return derTag(0xA0 + tag, content);
  }

  /** Decode a PEM string to DER bytes */
  function pemToDER(pem: string): Buffer {
    const b64 = pem
      .split("\n")
      .filter((line) => !line.startsWith("---"))
      .join("");
    return Buffer.from(b64, "base64");
  }

  // ─── Build X.509 v3 Certificate ──────────────────────────

  const serial = Date.now();
  const notBefore = new Date();
  const notAfter = new Date();
  notAfter.setFullYear(notAfter.getFullYear() + 10);

  // SubjectPublicKeyInfo DER (from PEM output of generateKeyPairSync)
  const pubKeyDer = pemToDER(publicKeyPem);

  // Subject Key Identifier = SHA-1 of the public key BIT STRING within the SPKI.
  // We hash the entire SPKI DER for simplicity — this is what OpenSSL does.
  const keyHash = crypto.createHash("sha1").update(pubKeyDer).digest();

  // ── TBSCertificate ───────────────────────────────────────
  const tbsCert = derSequence([
    // version [0] EXPLICIT INTEGER { v3(2) }
    derExplicit(0, derInteger(2)),
    // serialNumber
    derInteger(serial),
    // signature (AlgorithmIdentifier)
    derSequence([derOID("1.2.840.113549.1.1.11"), derNull()]),
    // issuer Name
    derSequence([derSet([derSequence([derOID("2.5.4.3"), derTag(0x0C, Buffer.from("SessionBridge", "utf8"))])])]),
    // validity
    derSequence([derUTCTime(notBefore), derUTCTime(notAfter)]),
    // subject Name (same as issuer for self-signed)
    derSequence([derSet([derSequence([derOID("2.5.4.3"), derTag(0x0C, Buffer.from("SessionBridge", "utf8"))])])]),
    // subjectPublicKeyInfo (the SPKI DER directly)
    pubKeyDer,
    // extensions [3] EXPLICIT
    derExplicit(3, derSequence([
      derSequence([
        derOID("2.5.29.14"), // subjectKeyIdentifier
        derOctetString(derOctetString(keyHash)),
      ]),
    ])),
  ]);

  // ── Sign TBS Certificate ─────────────────────────────────
  const sign = crypto.createSign("sha256");
  sign.update(tbsCert);
  const signature = sign.sign(privateKeyPem);

  // ── Certificate = SEQUENCE { TBS, SigAlgo, Signature } ────
  const certDer = derSequence([
    tbsCert,
    derSequence([derOID("1.2.840.113549.1.1.11"), derNull()]),
    derBitString(signature),
  ]);

  // ── Convert to PEM ───────────────────────────────────────
  const b64 = certDer.toString("base64");
  const lines = b64.match(/.{1,64}/g) || [];
  return "-----BEGIN CERTIFICATE-----\n" + lines.join("\n") + "\n-----END CERTIFICATE-----\n";
}
