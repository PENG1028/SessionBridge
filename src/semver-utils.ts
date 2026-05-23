// ─── Lightweight semver helpers ────────────────────────────────
// Local copy — formerly in extensions/semver.ts.

export interface SemVer { major: number; minor: number; patch: number }

export function parseSemver(v: string): SemVer | null {
  const m = v.replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return { major: parseInt(m[1], 10), minor: parseInt(m[2], 10), patch: parseInt(m[3], 10) };
}

export type VersionDiff = 'same' | 'patch' | 'minor' | 'major';

export function compareSemver(a: SemVer, b: SemVer): VersionDiff {
  if (a.major !== b.major) return 'major';
  if (a.minor !== b.minor) return 'minor';
  if (a.patch !== b.patch) return 'patch';
  return 'same';
}

/** Human-readable mismatch severity. */
export function mismatchSeverity(agentVersion: string, serverVersion: string): {
  diff: VersionDiff;
  message: string;
} | null {
  const agent = parseSemver(agentVersion);
  const server = parseSemver(serverVersion);
  if (!agent || !server) return null;
  const diff = compareSemver(agent, server);
  if (diff === 'same') return null;
  const messages: Record<VersionDiff, string> = {
    major: `Version mismatch (major): agent v${agentVersion} vs relay v${serverVersion}. Update required.`,
    minor: `Version mismatch (minor): agent v${agentVersion} vs relay v${serverVersion}. Update recommended.`,
    patch: `Version mismatch (patch): agent v${agentVersion} vs relay v${serverVersion}. Optional update available.`,
    same: '',
  };
  return { diff, message: messages[diff] };
}
