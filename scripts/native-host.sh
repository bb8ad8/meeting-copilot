#!/usr/bin/env bash

set -eu

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
environment_node_path="${MEETING_COPILOT_NODE_PATH:-}"

if [ -f "$repo_root/.meeting-copilot.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$repo_root/.meeting-copilot.env"
  set +a
fi
if [ -n "$environment_node_path" ]; then
  MEETING_COPILOT_NODE_PATH="$environment_node_path"
fi

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"
node_binary="${MEETING_COPILOT_NODE_PATH:-}"

if [ -z "$node_binary" ] || [ ! -x "$node_binary" ]; then
  node_binary="$(command -v node || true)"
fi

if [ -z "$node_binary" ] || [ ! -x "$node_binary" ]; then
  for candidate in \
    /opt/homebrew/opt/node/bin/node \
    /opt/homebrew/opt/node@*/bin/node \
    /usr/local/opt/node/bin/node \
    /usr/local/opt/node@*/bin/node \
    "$HOME"/.nvm/versions/node/*/bin/node; do
    if [ -x "$candidate" ]; then
      node_binary="$candidate"
      break
    fi
  done
fi

if [ -z "$node_binary" ] || [ ! -x "$node_binary" ]; then
  printf 'Meetron Native Host could not locate Node.js. Run install-control-ui.sh again.\n' >&2
  exit 127
fi

exec "$node_binary" "$repo_root/scripts/native-host.mjs" "$@"
