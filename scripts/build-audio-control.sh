#!/usr/bin/env bash

set -eu

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
exec swift build \
  --package-path "$repo_root/native/audio-control" \
  -c release \
  --arch arm64 \
  --arch x86_64
