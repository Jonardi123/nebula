# Nebula Mobile PWA

Nebula Mobile is an installable iPhone companion. The Windows app remains the
source of truth for conversations, models, memory, tools, approvals, and local
storage. The phone never connects directly to LM Studio.

## Requirements

- Nebula running on the Windows PC, including in the tray
- Tailscale signed into the same tailnet on the PC and iPhone
- Tailscale Serve enabled for the PC; Funnel must remain disabled
- The PC awake and connected when starting or continuing an AI run

## Connect

1. Open **Mobile Connection** from Nebula's sidebar.
2. Enable the private Tailscale link.
3. Open the displayed HTTPS URL or scan its QR code on the iPhone.
4. Generate a pairing code on the PC and enter it on the phone.
5. In Safari, choose **Share > Add to Home Screen**.

Pairing codes are single-use and expire after ten minutes. A successful pairing
creates a random device token. The phone stores the token in IndexedDB and the PC
stores only its SHA-256 hash in Nebula's SQLite database. Paired devices can be
revoked from the desktop panel.

## Behavior

- Chat, folders, history, and search use Nebula's durable desktop conversation store.
- Responses stream from the normal Nebula agent loop.
- One agent run can be active globally. Mobile receives a busy response instead
  of replacing desktop work.
- Mobile Stop cancels only the run started by that paired phone.
- Risky tools use the existing approval flow. High-risk approvals require typing
  `CONFIRM`, and hard-blocked actions remain blocked.
- Messages are not silently queued while the PC is unavailable.
- The service worker caches only the application shell and previously loaded
  conversation summaries. It does not cache credentials, API responses, or tool output.

## Privacy Boundary

The bridge binds only to `127.0.0.1:47631`. Tailscale Serve provides private HTTPS
inside the tailnet. Do not enable Tailscale Funnel for Nebula. Mobile API responses
exclude provider keys, hidden prompts, private diagnostics, raw filesystem access,
and internal tool output.

## Development

Build only the PWA:

```powershell
npm.cmd run mobile:build
```

Build the complete desktop application with the PWA embedded:

```powershell
npm.cmd run build
npm.cmd run tauri:build
```

The bridge exposes versioned `/api/v1` endpoints for pairing, conversations,
search, runs, SSE events, cancellation, approvals, and status. New endpoints must
preserve the same authenticated and redacted mobile boundary.

## Troubleshooting

- **Offline on iPhone:** wake the PC, start Nebula, and confirm both devices are
  connected to Tailscale.
- **Pairing rejected:** generate a new code; old and already-used codes cannot be reused.
- **LM Studio unavailable:** start its local server and load a compatible model.
- **Private link unavailable:** reopen Mobile Connection and enable Serve again.
- **Old phone should no longer connect:** revoke it from Paired devices.
