#!/usr/bin/env bash
# SessionBridge Agent — cross-platform uninstaller
# Stops and removes the agent service and code.
set -euo pipefail

INSTALL_DIR="${HOME}/.sessionbridge"

usage() {
  cat <<'EOF'
bridge node uninstaller

Usage:
  ./uninstall-agent.sh [--install-dir <dir>] [--keep-code]

Options:
  --install-dir <dir>  Install directory (default: ~/.sessionbridge)
  --keep-code          Remove service registration but keep node code
EOF
  exit 0
}

KEEP_CODE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-dir) INSTALL_DIR="$2"; shift 2 ;;
    --install-dir=*) INSTALL_DIR="${1#*=}"; shift ;;
    --keep-code) KEEP_CODE=true; shift ;;
    -h|--help) usage ;;
    *) echo "Unknown option: $1"; usage ;;
  esac
done

OS="$(uname -s)"
echo "==> Uninstalling SessionBridge node..."
echo "    OS: ${OS}"

# ── Platform-specific service removal ────────────────
if [[ "${OS}" == "Darwin" ]]; then
  echo "==> Stopping launchd agent"
  launchctl bootout gui/$(id -u)/com.sessionbridge.node 2>/dev/null || true
  rm -f "${HOME}/Library/LaunchAgents/com.sessionbridge.node.plist"
  echo "  ✓ launchd agent removed"

elif [[ "${OS}" == "Linux" ]]; then
  echo "==> Stopping systemd user unit"
  systemctl --user stop sessionbridge-node 2>/dev/null || true
  systemctl --user disable sessionbridge-node 2>/dev/null || true
  rm -f "${HOME}/.config/systemd/user/sessionbridge-node.service"
  systemctl --user daemon-reload 2>/dev/null || true
  echo "  ✓ systemd user unit removed"
fi

# ── Remove node code ──────────────────────────────────
if [[ "${KEEP_CODE}" == "false" ]] && [[ -d "${INSTALL_DIR}" ]]; then
  echo "==> Removing node code: ${INSTALL_DIR}"
  rm -rf "${INSTALL_DIR}"
  echo "  ✓ Code removed"
elif [[ "${KEEP_CODE}" == "true" ]]; then
  echo "  (keeping code at ${INSTALL_DIR})"
fi

echo ""
echo "  SessionBridge node uninstalled."
