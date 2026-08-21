# Security Policy

## Supported versions

Security fixes are applied to the latest version on the default branch. This project is an early-stage macOS proof of concept and does not currently maintain older release branches.

## Reporting a vulnerability

Do not disclose security vulnerabilities in a public issue. Use GitHub's private vulnerability reporting for this repository, or contact the repository owner through their GitHub profile if private reporting is unavailable.

Include the affected version, macOS and Chrome versions, reproduction steps, impact, and any suggested mitigation. Avoid including meeting URLs, authentication data, cookies, or ChatGPT Project identifiers.

## Security boundaries

- The Chrome extension can invoke only predefined Native Messaging commands. It cannot submit arbitrary shell commands.
- The Meet page overlay uses a closed shadow root and accepts command clicks only from trusted user input.
- The service worker restricts privileged setup commands to extension pages and restricts Meet content scripts to meeting-control commands.
- Chrome DevTools endpoints bind to `127.0.0.1` and use installation-specific ports stored in the ignored local configuration file.
- The shared dedicated Chrome profile should be used only for Meetron. Anyone with access to the same macOS account can inspect that profile and local runtime files.
- Google Meet and ChatGPT Web are automated through their user interfaces. Upstream UI changes can cause a fail-closed launch or require code updates.
- The virtual audio plug-ins run inside the macOS Core Audio service. Release bundles must use Developer ID signing and notarization; ad-hoc signing is for local source builds only.

Before using this software with confidential meetings, review the source, organizational policy, participant-consent requirements, and the data controls of every connected service.
