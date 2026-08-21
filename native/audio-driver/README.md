# Meetron virtual audio driver

This directory builds two independent stereo Audio Server Plug-in bundles:

- `Meetron: Meeting to AI`
- `Meetron: AI to Meeting`

Each bundle is a loopback device. Audio written to its output stream is exposed
through its input stream. Keeping the two directions in separate devices avoids
feeding the assistant's own voice back into its microphone.

The plug-in implementation is derived from Apple's “Creating an Audio Server
Driver Plug-in” sample. Apple's original license is preserved in
`vendor/apple/LICENSE.txt`. Meetron changes the sample to use a fixed,
preallocated lock-free ring buffer and compile-time identities.

Build locally:

```sh
./native/audio-driver/build-driver.sh
```

Install locally (administrator password required):

```sh
./native/audio-driver/install-driver.sh
```

Ad-hoc signing is used by default. The build target defaults to macOS 13.0 and
the driver and controller are Universal Binaries for Apple Silicon and Intel.

Build a Universal Binary PKG (unsigned by default):

```sh
./native/audio-driver/package-driver.sh
```

Development packages are written to `dist/development/`. They are deliberately
kept separate from notarized release artifacts.

For a release, set the two Developer ID identities and either a notary keychain
profile or an App Store Connect API key stored outside this repository:

```sh
export MEETRON_AUDIO_SIGNING_IDENTITY='Developer ID Application: Your Name (TEAMID)'
export MEETRON_INSTALLER_SIGNING_IDENTITY='Developer ID Installer: Your Name (TEAMID)'

# Option A: a profile previously created with xcrun notarytool store-credentials
export MEETRON_NOTARY_PROFILE='MeetronNotary'

# Option B: an existing App Store Connect API key
export MEETRON_NOTARY_KEY='/secure/location/AuthKey_KEYID.p8'
export MEETRON_NOTARY_KEY_ID='KEYID'
export MEETRON_NOTARY_ISSUER='ISSUER-UUID'

npm run package:audio:release
MEETRON_REQUIRE_NOTARIZED=1 npm run test:package -- dist/release/MeetronAudio-0.1.1.pkg
```

Use only one notarization option. The package script signs the drivers and CLI,
signs the installer, submits it to Apple, staples the ticket, verifies
Gatekeeper acceptance, and finally writes the checksum. Private keys and
certificates are ignored by Git and must never be committed. The legacy
`MEETING_COPILOT_*` names remain accepted during migration.

Release artifacts are written to `dist/release/` only after every validation
passes. The script always refuses to overwrite an existing notarized package;
bump the package version or preserve and move the old artifact first.
