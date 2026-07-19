# Nebula

Current release: **Nebula: Black Matter** (`2.0.0`, build `2`). Black Matter is Nebula's first major named release, with selectable themes and a unified execution-control system across desktop and mobile.

Architecture and staged local-model platform roadmap: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

Nebula 2.0 adds consolidated model control, structured composer attachments, searchable and foldered conversations, persisted project health, context pins, memory-quality review, voice diagnostics, safe patch batches, and an optional Daily Brief. See [the workflow upgrade notes](docs/NEBULA_2_WORKFLOW.md).

Nebula is a Windows-first, local-first desktop AI assistant foundation built with Tauri, React, TypeScript, and Tailwind CSS. It uses LM Studio's local OpenAI-compatible chat completions API.

Default LM Studio endpoint:

```txt
http://localhost:1234/v1/chat/completions
```

## Features

- Codex-style dark chat workspace
- Fullscreen cosmic startup splash with boot status sequence and skip controls
- Skills system with enable/disable controls, permissions, risk levels, tool exposure, prompt additions, and examples
- Local prompt-skill builder for safe, non-executable skill packs
- Model dashboard with LM Studio model listing, load/warm actions, assignments, and local run stats
- Project Profiles with detected framework, package manager, scripts, notes, and preferred models
- Task Mode with replayable timeline records for prompts, model routes, tool calls, files, commands, errors, sources, and final results
- One-click Fix My App workflow that diagnoses and proposes a fix plan before editing
- Source Cards for web search/fetch results with URL, date checked, trust hints, and memory proposal action
- Local notification center for task completion, model load, failed commands, memory proposals, and app status
- Launcher for known apps, selected projects, indexed files, Nebula actions, and Screenshot Ask Mode
- Screenshot Ask flow through the Ctrl+Space ambient overlay
- Quick Actions for bug finding, project review, current-file explanation, code optimization, safe refactor planning, README summaries, model diagnosis, and temporary context clearing
- Agent Activity page with live operational state for planner, coding, review, memory, search, safety, and future connector agents
- Intelligent file explorer with search, file-type icons, git/recent markers, importance scoring, pins, favorites, inline AI actions, and lightweight file summaries
- Predictive suggestions for README, package metadata, and code files based on the active workspace
- AI Insights dashboard for daily requests, routing confidence, response time, skill/model usage, analyzed files, review count, and rough time-saved estimate
- Replay page for previous Nebula sessions using safe timeline summaries
- LM Studio status check and chat requests
- Agent loop with OpenAI-compatible function calling plus JSON tool fallback
- Safety classification for commands and tools
- Approval modal before dangerous actions
- File explorer with read-only file opening
- Local memory folder and Markdown memory files
- Terminal/action log with timestamps
- Agents, tools, memory, and settings panels
- Web Search skill with provider placeholder and manual/mock fallback
- Web Call skill with public webpage fetch, HTML stripping, content limits, and local/private URL blocking
- Tauri backend commands for filesystem, shell commands, app opening, system info, and sleep
- Placeholder architecture for ChatGPT, Gemini, offline STT/TTS, screenshot/vision, vector memory, dataset export, and multi-agent voting
- Recoverable chat sessions with pinned history and restart-safe task recovery
- Explicit Task Queue for long-running work that never auto-resumes risky/old operations after restart
- Local project content search from the Files panel (filename filter plus safe text search)
- Context Inspector and Privacy Dashboard for visible context/data boundaries
- Fine-Tuning Lab that redacts/filters accepted local traces into train/validation JSONL for QLoRA
- Private iPhone PWA with shared chat history, streaming responses, attachments, voice dictation, Stop, and mobile approval cards through Tailscale Serve
- Native iPhone companion project with Keychain pairing, native haptics/notifications, safe PC settings, and a Codemagic unsigned-IPA workflow. See [the iOS guide](docs/IOS_NATIVE.md).
- Black Matter and Nebula Original themes with live switching, accessible motion/transparency fallbacks, and the Event Horizon startup sequence
- Approval, Safe, and session-only Full Access execution modes with a permanent catastrophic-action blocklist
- Cancellable terminal jobs with streamed output, command history, execution receipts, health diagnostics, and process-tree termination
- Installed-app discovery, trusted aliases, recent apps, ambiguity handling, and audited app launches
- Twelve categorized built-in avatars plus custom image support

## Requirements

- Windows
- Node.js 20+
- Rust and Cargo for Tauri native app development
- LM Studio with the local server enabled

Rust is required for native Tauri development. If `cargo` is not visible after installing Rust, restart the terminal or add `%USERPROFILE%\.cargo\bin` to `PATH`.

## Setup

```powershell
npm.cmd install
```

Start LM Studio, load a coding model, and enable the local server. A coding model around 7B-20B is recommended.

## Run

Web development shell:

```powershell
npm.cmd run dev
```

Tauri desktop app:

```powershell
npm.cmd run tauri:dev
```

Production build:

```powershell
npm.cmd run build
npm.cmd run tauri:build
```

Mobile PWA development build:

```powershell
npm.cmd run mobile:build
```

The production desktop binary embeds the mobile build and serves it only on
`127.0.0.1:47631`. See [Mobile PWA](docs/MOBILE_PWA.md) for private Tailscale
setup, iPhone installation, pairing, and troubleshooting.

## LM Studio

Default settings:

- Endpoint: `http://localhost:1234/v1/chat/completions`
- Model: `local-model`
- Temperature: `0.4`
- Max tokens: `2048`

If LM Studio is running a different served model name, update it in Settings.

## Memory

Nebula creates:

```txt
memory/
user.md
projects.md
web_learnings.md
pc_fixes.md
lessons_learned.md
commands.md
preferences.md
```

Memory rules:

- Save useful lessons only
- Do not save random temporary junk
- Web-learned information needs source URL and date checked
- Old web information should be marked `needs verification`
- Save repeated fixes, preferences, and project-specific knowledge

## Skills

Skills live in `src/skills/` and define:

- Name and description
- Enabled/disabled state
- Required permissions
- Tools exposed to the model
- System prompt additions
- Examples
- Risk level

The Skills sidebar tab lets you enable or disable installed skills. Enabled skill tools are converted into LM Studio/OpenAI-compatible function tool definitions for the agent loop.

## Productivity Surfaces

Phase 2 adds daily-use surfaces that reuse Nebula's existing orchestration instead of bypassing it:

- Quick Actions start normal Nebula chat/task runs, so routing, context injection, skill selection, safety checks, and timeline logging still apply.
- File Explorer inline actions use the selected file as target context and never edit automatically.
- Agent Activity and AI Insights are read-only dashboards built from diagnostics, task history, skill stats, model stats, and timeline events.
- Replay Mode shows recorded actions, tools, files, routes, timings, and results. It does not expose hidden reasoning.
- Clear Temporary Context only clears transient session/UI context. It does not delete memory, tasks, profiles, source cards, or timeline history.

Installed skills:

- Memory
- Files
- Terminal
- Web Search
- Web Call
- PC Control

Web Search currently uses a manual/mock provider unless a SerpAPI, Tavily, or Brave provider is configured in the future. Web Call blocks private/local network URLs and downloadable file types by default.

## Safety Notes

Nebula defaults to **Allow Safe Executions**. **Ask for Approval** confirms every command or side-effectful tool. **Full Access** requires typing `ENABLE FULL ACCESS`, lasts only for the current session, and resets to Safe after restart.

Every mode permanently blocks drive formatting, credential theft, antivirus/security disabling, hidden execution flows, random download-and-execute commands, and destructive system-folder operations. Full Access does not bypass those guards and never elevates to administrator.

The app never runs commands as admin automatically. Commands run in the selected project folder by default.

## Fine-Tuning

Nebula can collect local, user-reviewed traces and create a redacted train/validation split in **Fine-Tuning Lab**. This is data preparation, not pretend training.

For an 8 GB GPU, the included practical experiment is a 4-bit QLoRA adapter for a Gemma 7B Hugging Face/Safetensors base model. LM Studio GGUF files are inference files and cannot be used as LoRA training bases. See [training/README.md](training/README.md) for preflight, dependency, dataset, and training steps.

## Roadmap

- Native Windows toast notifications
- Real cancellable process management
- File edit staging and multi-file diff review
- ChatGPT/Gemini escalation interfaces
- Offline voice input and TTS output
- Screenshot/vision agent
- Vector database memory
- Fine-tuning dataset export
- Multi-agent debate and voting
