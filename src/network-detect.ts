// ─── Network Detection ─────────────────────────────────────────
// Pure functions for detecting a node's network environment.
// Used by the "External Access" feature in the Dashboard.
//
// Detect: local IPs, LAN IPs, public IPs, port reachability,
//         TLS cert status, token authentication status.

import os from "os";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface NetworkDetectResult {
  /** Whether external access can be enabled */
  canExternal: boolean;
  /** Detected IP addresses with classification */
  ips: IpInfo[];
  /** Whether node has a public (non-private) IPv4 address */
  hasPublicIP: boolean;
  /** Whether the dashboard port seems reachable (not blocked by local firewall) */
  portReachable: boolean;
  /** Whether TLS cert files exist (auto-generated or user-provided) */
  hasTLS: boolean;
  /** Whether relayToken is configured (required for external access) */
  hasToken: boolean;
  /** Human-readable warnings */
  warnings: string[];
}

export interface IpInfo {
  type: "loopback" | "lan" | "public";
  addr: string;
  family: "IPv4" | "IPv6";
  interface: string;
}

// RFC 1918 private ranges + loopback
function classifyIP(addr: string): "loopback" | "lan" | "public" {
  if (addr.startsWith("127.")) return "loopback";
  if (addr.startsWith("10.")) return "lan";
  if (addr.startsWith("172.")) {
    const second = parseInt(addr.split(".")[1], 10);
    if (second >= 16 && second <= 31) return "lan";
  }
  if (addr.startsWith("192.168.")) return "lan";
  if (addr === "::1") return "loopback";
  // fe80::/10 = link-local (LAN)
  if (addr.startsWith("fe80:")) return "lan";
  return "public";
}

/**
 * Detect the network environment of the current node.
 *
 * @param port     - The port to check external access for (default 8080)
 * @param hasToken - Whether relayToken is configured
 * @param certDir  - Path to TLS cert directory (default ~/.sessionbridge)
 */
export function detectNetwork(
  port: number = 8080,
  hasToken: boolean = false,
  certDir?: string,
): NetworkDetectResult {
  const ifaces = os.networkInterfaces();
  const ips: IpInfo[] = [];
  let hasPublicIP = false;

  for (const [name, addrs] of Object.entries(ifaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.internal) {
        ips.push({ type: "loopback", addr: addr.address, family: addr.family, interface: name });
        continue;
      }
      const type = classifyIP(addr.address);
      if (type === "public") hasPublicIP = true;
      ips.push({ type, addr: addr.address, family: addr.family, interface: name });
    }
  }

  // Check TLS cert existence
  const defaultCertDir = certDir || join(homedir(), ".sessionbridge");
  const hasTLS =
    existsSync(join(defaultCertDir, "cert.pem")) &&
    existsSync(join(defaultCertDir, "key.pem"));

  // Build warnings
  const warnings: string[] = [];
  if (!hasToken) {
    warnings.push("未配置 relayToken 认证。对外暴露时需要认证令牌，否则任何知道地址的人都能访问。");
  }
  if (!hasPublicIP && ips.filter((i) => i.type === "lan").length > 0) {
    warnings.push("当前节点没有公网 IP，对外访问仅限局域网 (LAN)。");
  } else if (!hasPublicIP) {
    warnings.push("当前节点没有可路由的公网 IP 或 LAN IP，可能无法对外访问。");
  }
  if (!hasTLS) {
    warnings.push("未检测到 HTTPS 证书，对外访问将以 HTTP 进行（传输不加密，但应用层 AES-256-GCM 仍在）。");
  }

  // Port reachability heuristic:
  // If any non-loopback IP exists, assume port could be bound to it
  const hasNonLoopback = ips.some((i) => i.type !== "loopback");
  const portReachable = hasNonLoopback;

  const canExternal = (hasPublicIP || ips.some((i) => i.type === "lan")) && portReachable;

  return {
    canExternal,
    ips,
    hasPublicIP,
    portReachable,
    hasTLS,
    hasToken,
    warnings,
  };
}
