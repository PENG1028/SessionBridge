#!/usr/bin/env bash
# SessionBridge Node — cross-platform user-level installer
# Installs the Go Core runtime as a background service.
# Linux: systemd user unit   macOS: launchd agent
#
# Go Core is the sole runtime. Legacy Node relay has been retired.
# Configuration is via environment variables, not CLI flags.
#
# Usage: ./install-agent.sh [--install-dir /path] [--node /path/to/node]
set -euo pipefail

LABEL=""
INSTALL_DIR="${HOME}/.sessionbridge"
LISTEN_ADDR="127.0.0.1:8080"

usage() {
  cat <<'EOF'
SessionBridge Node installer (Go Core)

Usage:
  ./install-agent.sh [options]

Options:
  --install-dir <dir>  Install directory (default: ~/.sessionbridge)
  --listen <addr>      Listen address (default: 127.0.0.1:8080)
  --label <name>       Node label (default: hostname)
  --node <path>        Path to node binary (default: auto-detect)

Go Core env vars (set after install in the service file):
  LISTEN_ADDR               HTTP + WebSocket listen address
  SESSIONNODE_TOKEN         Auth token (empty = dev mode)
  SESSIONNODE_PLUGIN_DIRS   Plugin directories
  SESSIONNODE_DATA_DIR      Data directory

Install examples:
  ./install-agent.sh
  ./install-agent.sh --install-dir /opt/sessionbridge --listen 0.0.0.0:8080
EOF
  exit 0
}

# ── Parse args ──────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-dir) INSTALL_DIR="$2"; shift 2 ;;
    --install-dir=*) INSTALL_DIR="${1#*=}"; shift ;;
    --listen) LISTEN_ADDR="$2"; shift 2 ;;
    --listen=*) LISTEN_ADDR="${1#*=}"; shift ;;
    --label) LABEL="$2"; shift 2 ;;
    --label=*) LABEL="${1#*=}"; shift ;;
    --node) NODE_BIN="$2"; shift 2 ;;
    --node=*) NODE_BIN="${1#*=}"; shift ;;
    -h|--help) usage ;;
    *) echo "Unknown option: $1"; usage ;;
  esac
done

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
echo "==> Installing Go Core to ${INSTALL_DIR}"
mkdir -p "${INSTALL_DIR}"
# Copy source files (not node_modules or .next)
rsync -a --exclude='node_modules' --exclude='.next' --exclude='.git' "${PROJECT_DIR}/" "${INSTALL_DIR}/"
cd "${INSTALL_DIR}"
npm install --production --no-audit --no-fund 2>&1 | tail -1

# Build if Go binary not present
if [[ ! -f "${INSTALL_DIR}/dist/go-core/sessionnode" ]]; then
  echo "==> Building Go Core..."
  if command -v go >/dev/null 2>&1; then
    npm run build:core 2>&1 || echo "Warning: build:core failed, will use go run fallback"
  else
    echo "Warning: Go not found. Go Core will use 'go run' fallback at startup."
    echo "Install Go >= 1.21 for faster startup."
  fi
fi

# ── Go Core run command ────────────────────────────
# Legacy CLI flags (--role, --upstream, --dir, --dashboard-port, etc.)
# have been retired. Go Core uses environment variables.
NODE_CMD="${NODE_BIN} ${INSTALL_DIR}/bin/bridge.js core"

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
    <string>${INSTALL_DIR}/bin/bridge.js</string>
    <string>core</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${INSTALL_DIR}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>LISTEN_ADDR</key>
    <string>${LISTEN_ADDR}</string>
    <key>SESSIONNODE_DATA_DIR</key>
    <string>${INSTALL_DIR}/data</string>
    <key>SESSIONNODE_PLUGIN_DIRS</key>
    <string>${INSTALL_DIR}/plugins</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${INSTALL_DIR}/core.log</string>
  <key>StandardErrorPath</key>
  <string>${INSTALL_DIR}/core.log</string>
</dict>
</plist>
PLISTEOF

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
Description=SessionBridge Go Core
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${NODE_BIN} ${INSTALL_DIR}/bin/bridge.js core
WorkingDirectory=${INSTALL_DIR}
Environment=LISTEN_ADDR=${LISTEN_ADDR}
Environment=SESSIONNODE_DATA_DIR=${INSTALL_DIR}/data
Environment=SESSIONNODE_PLUGIN_DIRS=${INSTALL_DIR}/plugins
Restart=always
RestartSec=5
StandardOutput=append:${INSTALL_DIR}/core.log
StandardError=append:${INSTALL_DIR}/core.log

[Install]
WantedBy=default.target
SVCEOF

  systemctl --user daemon-reload
  systemctl --user enable sessionbridge-agent
  systemctl --user restart sessionbridge-agent
  echo "  ✓ systemd user unit installed and started"

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
echo "  Go Core installed successfully"
echo "  Listen:    http://${LISTEN_ADDR}"
echo "  Health:    http://${LISTEN_ADDR}/health"
echo "  Logs:      ${INSTALL_DIR}/core.log"
echo "──────────────────────────────────────────"
