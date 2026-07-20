# Nebula for iPhone

Nebula Mobile is a Capacitor iOS companion. It keeps models, memory, tools, and durable conversations on the Windows PC and connects through the private Tailscale bridge.

## What is included

- Native iOS shell with the Nebula mobile React interface
- Shared streaming conversations, search, attachments, Stop, approvals, voice fallback, and safe settings
- Keychain-backed pairing token through the local `NebulaSecureStorage` plugin
- Native haptics, sharing, keyboard handling, status bar, splash screen, and local completion notifications
- PWA fallback at the private Tailscale URL configured by the user
- Manual Codemagic workflow that creates an unsigned IPA for personal sideloading

## Build locally on macOS

```bash
npm ci
npm run mobile:ios:sync
npm run mobile:ios:validate
npx cap open ios
```

The bundle identifier is `com.jonard.nebula` and the minimum supported version is iOS 16.

## Build with Codemagic

1. Push the scrubbed repository to GitHub.
2. Add it to Codemagic.
3. Start the `Nebula iOS unsigned IPA` workflow manually.
4. Download `Nebula-sideload.ipa` from the build artifacts. It carries only an ad-hoc integrity signature; Sideloadly replaces it with your personal Apple signature.
5. Sign and install it with Sideloadly, AltStore, or another personal signing tool using your own Apple ID.

The workflow intentionally does not store Apple credentials and does not publish the app. Personal signing is the final external step.

## Runtime requirements

- Nebula Desktop must be running on the PC.
- The PC and iPhone must be connected to the same Tailscale network.
- Tailscale Serve must point the private HTTPS hostname to `127.0.0.1:47631`.
- Pair the iPhone with the one-time code shown by Nebula Desktop.
- On a fresh native install, enter the private HTTPS address shown by Mobile Connection. Existing paired installs preserve their saved address during upgrades.

When the PC is unavailable, the app shows a clear offline state instead of pretending a request was queued.
