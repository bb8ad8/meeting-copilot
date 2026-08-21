#!/usr/bin/env bash

set -euo pipefail

driver_root="$(cd "$(dirname "$0")" && pwd)"
test_binary="$(mktemp "${TMPDIR:-/tmp}/meeting-copilot-ring-test.XXXXXX")"
trap 'rm -f "$test_binary"' EXIT

xcrun clang \
  -std=c11 \
  -Wall \
  -Wextra \
  -Werror \
  -o "$test_binary" \
  "$driver_root/MeetingCopilotRingBuffer.c" \
  "$driver_root/tests/RingBufferTests.c"
"$test_binary"
printf 'Audio ring buffer tests passed.\n'
