#!/usr/bin/env bash

set -eu

dry_run=0
uninstall=0
quiet=0

usage() {
  cat <<'EOF'
Usage: ./scripts/install-control-ui.sh [options]

Registers the Meetron Native Messaging Host for Google Chrome.
The unpacked extension is loaded once from chrome://extensions in Developer mode.

Options:
  --dry-run      Print the manifest without installing it.
  --uninstall    Remove the registered Native Messaging Host manifest.
  --quiet        Suppress setup instructions.
  -h, --help     Show this help.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run)
      dry_run=1
      ;;
    --uninstall)
      uninstall=1
      ;;
    --quiet)
      quiet=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
extension_dir="$repo_root/extension"
host_path="$repo_root/scripts/native-host.sh"
extension_id='jlikakgdldiihhflkobhnpfegjlcakdd'
profile_dir="${MEETING_COPILOT_PROFILE_DIR:-$HOME/Library/Application Support/MeetingCopilot/GPTParticipantChrome}"
manifest_name='com.meeting_copilot.host.json'
manifest_dirs=(
  "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
  "$profile_dir/NativeMessagingHosts"
)

if [ ! -f "$extension_dir/manifest.json" ]; then
  printf 'Extension manifest not found: %s\n' "$extension_dir/manifest.json" >&2
  exit 1
fi

if [ "$uninstall" -eq 1 ]; then
  for manifest_dir in "${manifest_dirs[@]}"; do
    manifest_path="$manifest_dir/$manifest_name"
    if [ "$dry_run" -eq 1 ]; then
      printf '[DRY RUN] remove %s\n' "$manifest_path"
    else
      rm -f "$manifest_path"
      printf 'Removed Native Messaging Host manifest: %s\n' "$manifest_path"
    fi
  done
  exit 0
fi

if [ ! -d "$repo_root/node_modules/playwright-core" ]; then
  printf 'playwright-core is required. Run: npm install\n' >&2
  exit 1
fi

node_binary="${MEETING_COPILOT_NODE_PATH:-}"
if [ -z "$node_binary" ] || [ ! -x "$node_binary" ]; then
  node_binary="$(command -v node || true)"
fi
if [ -z "$node_binary" ] || [ ! -x "$node_binary" ]; then
  printf 'Node.js executable was not found. Install Node.js and run this installer again.\n' >&2
  exit 1
fi

manifest_json="$("$node_binary" -e '
  const [hostPath, extensionId] = process.argv.slice(1);
  process.stdout.write(`${JSON.stringify({
    name: "com.meeting_copilot.host",
    description: "Meetron local control host",
    path: hostPath,
    type: "stdio",
    allowed_origins: [`chrome-extension://${extensionId}/`],
  }, null, 2)}\n`);
' "$host_path" "$extension_id")"

if [ "$dry_run" -eq 1 ]; then
  for manifest_dir in "${manifest_dirs[@]}"; do
    printf '[DRY RUN] install %s/%s\n' "$manifest_dir" "$manifest_name"
  done
  printf '%s' "$manifest_json"
  exit 0
fi

chmod +x "$host_path" "$repo_root/scripts/native-host.mjs"

env_path="$repo_root/.meeting-copilot.env"
touch "$env_path"
chmod 600 "$env_path"

"$node_binary" -e '
  const fs = require("node:fs");
  const [path, nodePath] = process.argv.slice(1);
  const text = fs.readFileSync(path, "utf8");
  const quote = (value) => `\x27${value.replaceAll("\x27", `\x27\\\x27\x27`)}\x27`;
  const setting = `MEETING_COPILOT_NODE_PATH=${quote(nodePath)}`;
  const updated = /^MEETING_COPILOT_NODE_PATH=.*$/m.test(text)
    ? text.replace(/^MEETING_COPILOT_NODE_PATH=.*$/m, setting)
    : `${text.trimEnd()}${text.trim() ? "\n" : ""}${setting}\n`;
  const temporary = `${path}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, updated, { mode: 0o600 });
  fs.renameSync(temporary, path);
' "$env_path" "$node_binary"

if ! grep -Eq '^MEETING_COPILOT_CDP_PORT=' "$env_path" 2>/dev/null; then
  generated_port="$("$node_binary" -e '
    const net = require("node:net");
    const server = net.createServer();
    server.unref();
    server.on("error", () => process.exit(1));
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => process.stdout.write(`${port}\n`));
    });
  ')"
  printf 'MEETING_COPILOT_CDP_PORT=%s\n' "$generated_port" >> "$env_path"
fi

# Version 0.6 uses one shared Chrome process and a single CDP endpoint.
if grep -Eq '^MEETING_COPILOT_CHATGPT_CDP_PORT=' "$env_path" 2>/dev/null; then
  "$node_binary" -e '
    const fs = require("node:fs");
    const path = process.argv[1];
    const text = fs.readFileSync(path, "utf8");
    const updated = text.replace(/^MEETING_COPILOT_CHATGPT_CDP_PORT=.*(?:\r?\n|$)/m, "");
    const temporary = `${path}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, updated, { mode: 0o600 });
    fs.renameSync(temporary, path);
  ' "$env_path"
fi

for manifest_dir in "${manifest_dirs[@]}"; do
  manifest_path="$manifest_dir/$manifest_name"
  mkdir -p "$manifest_dir"
  printf '%s' "$manifest_json" > "$manifest_path"
done

printf 'Native Messaging Host installed.\n'
for manifest_dir in "${manifest_dirs[@]}"; do
  printf '  Manifest:  %s/%s\n' "$manifest_dir" "$manifest_name"
done
printf '  Extension: %s\n' "$extension_dir"
printf '  ID:        %s\n' "$extension_id"

if [ "$quiet" -ne 1 ]; then
  cat <<EOF

Load the controller extension in your regular Chrome from:

  $extension_dir

Then open the shared Meetron Chrome setup page with:

  $repo_root/scripts/open-control-ui-setup.sh

Load the same unpacked extension in regular Chrome and the shared dedicated
profile. That profile hosts both the GPT participant and ChatGPT Voice tabs.
EOF
fi
