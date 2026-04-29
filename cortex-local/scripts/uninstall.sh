#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# cortex-local uninstall.sh
# Unloads the launchd agent and removes the installed daemon files.
# Config, state, and Keychain entry are preserved (see notes below).
# ---------------------------------------------------------------------------

INSTALL_DIR="${HOME}/.cortex-local"
PLIST_DST="${HOME}/Library/LaunchAgents/com.cortex.local.plist"
CONFIG_DIR="${HOME}/Library/Application Support/cortex-local"

echo "=== cortex-local uninstaller ==="
echo ""

# ---------------------------------------------------------------------------
# 1. Unload the launchd agent
# ---------------------------------------------------------------------------
echo "--- Stopping and removing launchd agent ---"
launchctl bootout "gui/$(id -u)/com.cortex.local" 2>/dev/null \
  || launchctl unload -w "${PLIST_DST}" 2>/dev/null \
  || true

if [[ -f "${PLIST_DST}" ]]; then
  rm -f "${PLIST_DST}"
  echo "Removed ${PLIST_DST}"
else
  echo "Plist not found at ${PLIST_DST} (already removed?)."
fi

# ---------------------------------------------------------------------------
# 2. Optionally remove the install directory
# ---------------------------------------------------------------------------
echo ""
if [[ -d "${INSTALL_DIR}" ]]; then
  read -rp "Remove install directory ${INSTALL_DIR}? [y/N]: " REMOVE_INSTALL
  if [[ "${REMOVE_INSTALL}" =~ ^[Yy]$ ]]; then
    rm -rf "${INSTALL_DIR}"
    echo "Removed ${INSTALL_DIR}"
  else
    echo "Skipped — install directory kept at ${INSTALL_DIR}."
  fi
fi

# ---------------------------------------------------------------------------
# 3. Notes about preserved data
# ---------------------------------------------------------------------------
echo ""
echo "=== Uninstall complete ==="
echo ""
echo "Preserved (not removed automatically):"
echo "  Config + state : ${CONFIG_DIR}"
echo "  Keychain entry : 'cortex-local' / 'shared-secret'"
echo ""
echo "To also remove the Keychain entry, run:"
echo "  security delete-generic-password -s cortex-local -a shared-secret"
echo ""
echo "To also remove config and state:"
echo "  rm -rf \"${CONFIG_DIR}\""
