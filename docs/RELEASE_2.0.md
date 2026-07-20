# Nebula 2.0: Black Matter

Nebula 2.0 is the Build Week release of the local AI operating layer for Windows, with a private iPhone companion.

## Highlights

- Black Matter and Nebula Original themes
- SQLite-backed conversations, search, recovery, timeline, and diagnostics
- LM Studio model discovery, routing, warm loading, and single-model mode
- Cancellable terminal jobs with streamed output and execution receipts
- Approval, Safe, and session-only Full Access execution modes
- Installed-app discovery and audited launching
- Live web research with validated public sources
- Voice and native/PWA iPhone companion improvements

## Install

1. Download `Nebula_2.0.0_x64-setup.exe`.
2. Verify its SHA-256 checksum against `Nebula_2.0.0_x64-setup.exe.sha256`.
3. Install and launch Nebula.
4. In LM Studio, load a compatible instruction or coding GGUF and start the local server.
5. Select the discovered model in Nebula. The default endpoint is `http://localhost:1234/v1/chat/completions`.

Models are not bundled. Nebula remains usable while LM Studio is offline and shows a recoverable connection state.

## Safety

Nebula starts in Safe mode. Full Access lasts only for the current session, requires typed confirmation, never elevates to administrator, and does not bypass catastrophic-action blocks.

## Rollback

If 2.0 does not work on a system, uninstall it and reinstall the previous Nebula package. Conversations and settings are backed up during the durable-storage migration; do not delete `%LOCALAPPDATA%\Nebula` when preserving local state.

## Checksum

```text
SHA-256  3EBCBB03FC4B65E0C3FCD6B81481EF942D7827FE7417B58C47692B1F31EBC662
```
