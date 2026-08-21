# Contributing

Contributions are welcome. This project automates frequently changing consumer web interfaces, so changes should stay small, fail closed around audio and microphone controls, and include focused tests.

## Development

Requirements are macOS 13 or later, Xcode Command Line Tools, Google Chrome, Node.js 22 or 24 LTS, and npm.

```bash
npm ci
npm test
```

Native audio source changes additionally require:

```bash
npm run test:native
npm run build:audio
```

Release package changes additionally require `npm run package:audio` followed by `npm run test:package`. The packaged `meetron-audioctl` is written in Swift, but no Swift toolchain is required to install or run the distributed PKG.

The browser UI test uses the locally installed Google Chrome. Set `MEETING_COPILOT_SKIP_BROWSER_TEST=1` only when Chrome is unavailable; run the full test before proposing user-interface or automation changes.

## Pull requests

- Do not commit `.meeting-copilot.env`, `.meeting-copilot-runtime`, meeting URLs, Project IDs, logs, cookies, or dedicated Chrome profiles.
- Add tests for command authorization, URL validation, microphone verification, and other changed behavior.
- Update user documentation when setup, permissions, storage, or operating steps change.
- Keep external dependencies minimal and document why a new dependency is necessary.
- Keep allocations, locks, file IO, and logging out of the audio driver's real-time callback.
- Confirm `npm audit --audit-level=high` before submitting.

By contributing, you agree that your contribution is licensed under GPL-3.0-only.
