#!/usr/bin/env bash
# SessionBridge Node (leaf) — cross-platform user-level installer
# Installs a bridge node in leaf mode, connecting to an upstream relay.
# Linux: systemd user unit   macOS: launchd agent
# Usage: ./install-agent.sh --relay ws://YOUR_HOST:8080 [--dir /path] [--label my-name]
set -euo pipefail

RELAY=""
DIR="${HOME}"
LABEL=""
DASHBOARD_PORT="9843"
INSTALL_DIR="${HOME}/.sessionbridge"

usage() {
  cat <<'EOF'
bridge node installer (leaf mode)

Usage:
  ./install-agent.sh --relay <url> [options]

Required:
  --relay <url>       Upstream relay WebSocket URL (e.g. ws://10.0.0.1:8080)

Options:
  --dir <path>        Working directory (default: $HOME)
  --label <name>      Node label (default: hostname)
  --dashboard-port N  Dashboard HTTP port (default: 9843)
  --install-dir <dir> Install directory (default: ~/.sessionbridge)
  --node <path>       Path to node binary (default: auto-detect)

Install examples:
  ./install-agent.sh --relay ws://my-server:8080 --dir ~/projects
  ./install-agent.sh --relay ws://my-server:8080 --label office-pc
EOF
  exit 0
}

# ── Parse args ──────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --relay) RELAY="$2"; shift 2 ;;
    --relay=*) RELAY="${1#*=}"; shift ;;
    --dir) DIR="$2"; shift 2 ;;
    --dir=*) DIR="${1#*=}"; shift ;;
    --label) LABEL="$2"; shift 2 ;;
    --label=*) LABEL="${1#*=}"; shift ;;
    --dashboard-port) DASHBOARD_PORT="$2"; shift 2 ;;
    --dashboard-port=*) DASHBOARD_PORT="${1#*=}"; shift ;;
    --install-dir) INSTALL_DIR="$2"; shift 2 ;;
    --install-dir=*) INSTALL_DIR="${1#*=}"; shift ;;
    --node) NODE_BIN="$2"; shift 2 ;;
    --node=*) NODE_BIN="${1#*=}"; shift ;;
    -h|--help) usage ;;
    *) echo "Unknown option: $1"; usage ;;
  esac
done

if [[ -z "${RELAY}" ]]; then
  echo "Error: --relay is required"
  usage
fi

# ── Detect node ─────────────────────────────────────
NODE_BIN="${NODE_BIN:-}"
if [[ -z "${NODE_BIN}" ]]; then
  NODE_BIN=$(command -v node 2>/dev/null || echo "")
fi
if [[ -z "${NODE_BIN}" ]]; then
  NODE_BIN=$(command -v nodejs 2>/dev/null || echo "")
fi
if [[ -z "${NODE_BIN}" ]]; then
  echo "Error: node not found. Install Node.js or use --node <path>"
  exit 1
fi
echo "  Node: ${NODE_BIN} ($(${NODE_BIN} --version))"

# ── Label default ───────────────────────────────────
LABEL="${LABEL:-$(hostname)}"

# ── Source directory (where this script lives) ──────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [[ ! -f "${PROJECT_DIR}/package.json" ]]; then
  echo "Error: session-bridge project not found at ${PROJECT_DIR}"
  exit 1
fi

# ── Install agent code ──────────────────────────────
echo ""
echo "==> Installing node (leaf) to ${INSTALL_DIR}"
mkdir -p "${INSTALL_DIR}"
# Copy source files (not node_modules or .next)
rsync -a --exclude='node_modules' --exclude='.next' --exclude='.git' "${PROJECT_DIR}/" "${INSTALL_DIR}/"
cd "${INSTALL_DIR}"
npm install --production --no-audit --no-fund 2>&1 | tail -1

# ── Node run command ───────────────────────────────
NODE_CMD="${NODE_BIN} ${INSTALL_DIR}/dist/index.js \
--role leaf \
--upstream ${RELAY} \
--dir ${DIR} \
--label ${LABEL} \
--dashboard-port ${DASHBOARD_PORT} \
--log-file ${INSTALL_DIR}/node.log \
--pid-file ${INSTALL_DIR}/node.pid"

# ── Platform-specific registration ──────────────────
OS="$(uname -s)"
echo ""

if [[ "${OS}" == "Darwin" ]]; then
  echo "==> macOS detected — installing launchd agent"

  LAUNCHD_DIR="${HOME}/Library/LaunchAgents"
  mkdir -p "${LAUNCHD_DIR}"
  PLIST="${LAUNCHD_DIR}/com.sessionbridge.agent.plist"

  cat > "${PLIST}" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.sessionbridge.node</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${INSTALL_DIR}/dist/index.js</string>
    <string>--role</string>
    <string>leaf</string>
    <string>--upstream</string>
    <string>${RELAY}</string>
    <string>--dir</string>
    <string>${DIR}</string>
    <string>--label</string>
    <string>${LABEL}</string>
    <string>--dashboard-port</string>
    <string>${DASHBOARD_PORT}</string>
    <string>--log-file</string>
    <string>${INSTALL_DIR}/node.log</string>
    <string>--pid-file</string>
    <string>${INSTALL_DIR}/node.pid</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${INSTALL_DIR}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${INSTALL_DIR}/node.log</string>
  <key>StandardErrorPath</key>
  <string>${INSTALL_DIR}/node.log</string>
</dict>
</plist>
PLISTEOF

  # Unload if already loaded, then load
  launchctl bootout gui/$(id -u)/com.sessionbridge.node 2>/dev/null || true
  launchctl bootstrap gui/$(id -u) "${PLIST}"
  echo "  ✓ LaunchAgent installed and started"

elif [[ "${OS}" == "Linux" ]]; then
  echo "==> Linux detected — installing systemd user unit"

  SYSTEMD_DIR="${HOME}/.config/systemd/user"
  mkdir -p "${SYSTEMD_DIR}"
  SERVICE="${SYSTEMD_DIR}/sessionbridge-agent.service"

  cat > "${SERVICE}" <<SVCEOF
[Unit]
Description=SessionBridge Node (Leaf)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${NODE_CMD}
WorkingDirectory=${INSTALL_DIR}
Restart=always
RestartSec=5
StandardOutput=append:${INSTALL_DIR}/node.log
StandardError=append:${INSTALL_DIR}/node.log

[Install]
WantedBy=default.target
SVCEOF

  systemctl --user daemon-reload
  systemctl --user enable sessionbridge-node
  systemctl --user restart sessionbridge-node
  echo "  ✓ systemd user unit installed and started"

  # Enable lingering so the user service starts at boot
  if command -v loginctl >/dev/null 2>&1; then
    loginctl enable-linger "${USER}" 2>/dev/null || true
  fi

else
  echo "Warning: Unsupported OS '${OS}'. Code installed but no service registered."
  echo "Run manually:"
  echo "  ${NODE_CMD}"
fi

echo ""
echo "──────────────────────────────────────────"
echo "  Node (leaf) installed successfully"
echo "  Dashboard: http://localhost:${DASHBOARD_PORT}"
echo "  Logs:      ${INSTALL_DIR}/node.log"
echo "  Config:    ${INSTALL_DIR}/agent.json"
echo "──────────────────────────────────────────"
