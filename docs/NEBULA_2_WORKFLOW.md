# Nebula 2.0 Workflow Upgrade

Nebula keeps one user-facing identity while routing local work across daily, coding, and review roles. This upgrade consolidates the controls around that architecture and adds recoverable local workflow state.

## Model Control

The Model Control panel combines assignments, inventory, Model Doctor, and speed profiling. The daily role stays warm when configured, coding can preload from typing intent, and review remains lazy. A failed role now resolves a different installed or loaded fallback and verifies it before continuing.

Remote providers remain optional. When 9Router or OpenRouter is active, Settings and Model Control identify the route as remote. LM Studio remains the local-first default.

## Conversations

Conversation storage is migrated into Nebula's SQLite repository with a verified legacy backup and rollback path. User-created folders and indexed search preserve existing sessions. Ctrl+K searches actions, project files, models, panels, and conversations.

Malformed or unavailable browser storage falls back to a recoverable local session instead of breaking chat.

## Context

Composer attachments are structured records rather than text inserted into the visible prompt. Supported attachment kinds are files, folders, project context, and screen context. Attachments are shown on the user message and converted into a compact local context block only for the agent request.

Context Inspector sections can be pinned. Enabled pins are injected at high priority and survive conversation/model switches. Project-scoped pins only apply to their matching workspace.

## Project Workflow

Workspace observations create a persisted project-health report containing metadata, Git, recent build evidence, unfinished tasks, errors, and suggested actions. Fix My App includes that evidence, runs an evidence-first diagnosis, and may create reviewable patch proposals. It never auto-applies patches.

Patch Workspace supports selecting and applying multiple proposals. Duplicate target paths are blocked from batch application because their base contents may conflict.

## Memory And Voice

Memory Quality audits local entries for duplicates, temporary text, missing web sources, missing checked dates, and stale web findings. It does not silently delete memories.

Voice diagnostics record WebView recognition support, microphone permission state, language, latest successful transcript, and the latest error. Diagnostics never stores microphone audio.

## Safety And Privacy

Normal low-risk actions stay fast and logged. Existing destructive/security blocks remain in command safety. Remote provider settings clearly state that prompts and injected context can leave the PC. Training logs remain local and export-only.

## Verification

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run build
npm.cmd run tauri:build
```

The Vitest suite covers conversation migration/search, daily-code-review routing, service health states, and composer focus/send behavior.
