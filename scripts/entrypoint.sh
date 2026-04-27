#!/bin/sh
set -e

# Materialize the SSH deploy key from a base64-encoded Fly secret.
# We do this at runtime (not build time) so the key never lives in image layers.
if [ -n "$NIRVANA_WIKI_DEPLOY_KEY_B64" ] && [ -n "$NIRVANA_WIKI_SSH_KEY_PATH" ]; then
  mkdir -p "$(dirname "$NIRVANA_WIKI_SSH_KEY_PATH")"
  echo "$NIRVANA_WIKI_DEPLOY_KEY_B64" | base64 -d > "$NIRVANA_WIKI_SSH_KEY_PATH"
  # SSH refuses keys with group/world-readable permissions
  chmod 600 "$NIRVANA_WIKI_SSH_KEY_PATH"

  # Pre-add github.com to known_hosts to avoid first-time host-key prompt
  mkdir -p /root/.ssh
  ssh-keyscan -H github.com >> /root/.ssh/known_hosts 2>/dev/null
  chmod 644 /root/.ssh/known_hosts
fi

exec node dist/src/main.js
