# 08 — Extension Audit

Static checks on extension manifests and build artifacts. No relay server needed.

## Code Modules Exercised

| Module | Path | Role |
|--------|------|------|
| Extension manifests | `extensions/*/sb-extension.json` | declaration validation |
| Extension code | `extensions/*/index.ts` | adapter exports |
| Build output | `dist/extensions/` | dist completeness |

## Tests

### 1. `extension-audit.test.mjs`
**E1-E4b checklist.** Manifest parse OK, extensionKind matches code exports, dist/ completeness, empty/pointless extension detection, duplicate IDs.
