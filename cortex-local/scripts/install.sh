#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# cortex-local install.sh
# Installs and bootstraps the cortex-local daemon under launchd on macOS.
# Run from the cortex-local/ directory (or anywhere; SCRIPT_DIR is resolved).
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

INSTALL_DIR="${HOME}/.cortex-local"
CONFIG_DIR="${HOME}/Library/Application Support/cortex-local"
STATE_DIR="${CONFIG_DIR}/state"
LOG_DIR="${HOME}/Library/Logs"
LAUNCH_AGENTS_DIR="${HOME}/Library/LaunchAgents"
PLIST_DST="${LAUNCH_AGENTS_DIR}/com.cortex.local.plist"
PLIST_TMPL="${SCRIPT_DIR}/com.cortex.local.plist.tmpl"
CONFIG_FILE="${CONFIG_DIR}/config.json"

KEYCHAIN_SERVICE="cortex-local"
KEYCHAIN_ACCOUNT="shared-secret"

echo "=== cortex-local installer ==="
echo "Install dir : ${INSTALL_DIR}"
echo "Config dir  : ${CONFIG_DIR}"
echo "State dir   : ${STATE_DIR}"
echo ""

# ---------------------------------------------------------------------------
# 1. Verify Node >= 20
# ---------------------------------------------------------------------------
NODE_BIN="$(command -v node 2>/dev/null || true)"
if [[ -z "${NODE_BIN}" ]]; then
  echo "ERROR: 'node' not found in PATH. Install Node.js >= 20 first."
  exit 1
fi
NODE_VERSION="$(node --version | sed 's/v//' | cut -d. -f1)"
if [[ "${NODE_VERSION}" -lt 20 ]]; then
  echo "ERROR: Node.js >= 20 required (found v${NODE_VERSION})."
  exit 1
fi
echo "Node        : ${NODE_BIN} (v${NODE_VERSION})"

# ---------------------------------------------------------------------------
# 2. Build and prepare directories
# ---------------------------------------------------------------------------
echo ""
echo "--- Building cortex-local ---"
cd "${REPO_DIR}"
npm install --silent
npm run build --silent

mkdir -p "${INSTALL_DIR}" "${CONFIG_DIR}" "${STATE_DIR}" "${LOG_DIR}" "${LAUNCH_AGENTS_DIR}"

echo "Copying dist/, node_modules/, package.json to ${INSTALL_DIR} ..."
cp -r dist/ "${INSTALL_DIR}/dist/"
cp -r node_modules/ "${INSTALL_DIR}/node_modules/"
cp package.json "${INSTALL_DIR}/package.json"

# ---------------------------------------------------------------------------
# 3. Shared secret — read from or store in macOS Keychain
# ---------------------------------------------------------------------------
echo ""
echo "--- Shared secret (macOS Keychain) ---"
EXISTING_SECRET="$(security find-generic-password -s "${KEYCHAIN_SERVICE}" -a "${KEYCHAIN_ACCOUNT}" -w 2>/dev/null || true)"
if [[ -z "${EXISTING_SECRET}" ]]; then
  while true; do
    read -rsp "Paste CORTEX_LOCAL_SHARED_SECRET (>= 32 chars, hidden): " SECRET
    echo ""
    if [[ ${#SECRET} -lt 32 ]]; then
      echo "Secret must be at least 32 characters. Try again."
    else
      break
    fi
  done
  security add-generic-password -U -s "${KEYCHAIN_SERVICE}" -a "${KEYCHAIN_ACCOUNT}" -w "${SECRET}"
  echo "Secret stored in Keychain."
else
  echo "Secret already in Keychain — reusing."
  SECRET="${EXISTING_SECRET}"
fi

# ---------------------------------------------------------------------------
# 4. Config file — prompt once, reuse on re-install
# ---------------------------------------------------------------------------
echo ""
echo "--- Config file ---"
if [[ -f "${CONFIG_FILE}" ]]; then
  echo "Config already exists at ${CONFIG_FILE} — skipping prompts (delete the file to reconfigure)."
else
  read -rp "Cortex API URL (e.g. https://cortex-hindole.fly.dev): " CORTEX_API_URL
  read -rp "Meetily/exporter output directory (e.g. ~/Documents/Meetily/exports): " MEETILY_OUTPUT_RAW
  # Expand ~ to absolute path
  MEETILY_OUTPUT_DIR="${MEETILY_OUTPUT_RAW/#\~/$HOME}"
  read -rp "Hostname label for this machine (e.g. mac-mini-home): " HOSTNAME_LABEL

  cat > "${CONFIG_FILE}" <<JSON
{
  "cortexApiUrl": "${CORTEX_API_URL}",
  "sharedSecret": "${SECRET}",
  "meetilyOutputDir": "${MEETILY_OUTPUT_DIR}",
  "host": "${HOSTNAME_LABEL}",
  "stateDir": "${STATE_DIR}"
}
JSON
  chmod 600 "${CONFIG_FILE}"
  echo "Config written to ${CONFIG_FILE} (chmod 600)."
fi

# ---------------------------------------------------------------------------
# 5. Render plist template
# ---------------------------------------------------------------------------
echo ""
echo "--- Rendering launchd plist ---"
# Escape paths for sed (replace / with \/)
ESC_NODE_BIN="${NODE_BIN//\//\\/}"
ESC_INSTALL_DIR="${INSTALL_DIR//\//\\/}"
ESC_CONFIG_PATH="${CONFIG_FILE//\//\\/}"
ESC_HOME="${HOME//\//\\/}"

sed \
  -e "s/__NODE_BIN__/${ESC_NODE_BIN}/g" \
  -e "s/__INSTALL_DIR__/${ESC_INSTALL_DIR}/g" \
  -e "s/__CONFIG_PATH__/${ESC_CONFIG_PATH}/g" \
  -e "s/__HOME__/${ESC_HOME}/g" \
  "${PLIST_TMPL}" > "${PLIST_DST}"

echo "Plist written to ${PLIST_DST}"

# ---------------------------------------------------------------------------
# 6. Bootstrap the launchd User Agent
# ---------------------------------------------------------------------------
echo ""
echo "--- Bootstrapping launchd agent ---"
# Bootout/unload first to handle re-install gracefully
launchctl bootout "gui/$(id -u)/com.cortex.local" 2>/dev/null || true
launchctl unload -w "${PLIST_DST}" 2>/dev/null || true

if launchctl bootstrap "gui/$(id -u)" "${PLIST_DST}" 2>/dev/null; then
  echo "Agent bootstrapped via 'launchctl bootstrap'."
else
  echo "bootstrap failed — falling back to 'launchctl load -w'."
  launchctl load -w "${PLIST_DST}"
fi

# ---------------------------------------------------------------------------
# 7. Print status
# ---------------------------------------------------------------------------
echo ""
echo "=== cortex-local installed ==="
echo ""
echo "Status     : launchctl print gui/$(id -u)/com.cortex.local"
echo "Logs (out) : tail -f ${LOG_DIR}/cortex-local.out.log"
echo "Logs (err) : tail -f ${LOG_DIR}/cortex-local.err.log"
echo "Config     : ${CONFIG_FILE}"
echo "State dir  : ${STATE_DIR}"
echo ""
echo "Expected first log lines:"
echo "  [cortex-local] starting; host=<your-host>; watching=<output-dir>"
echo "  [watcher] watching <output-dir> (stable after 5s)"
echo "  [heartbeat] cron registered: \"0 9 * * *\" UTC"
