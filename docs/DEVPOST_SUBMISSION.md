# Devpost Draft

## Title

Nebula: A Local AI Operating Layer

## Tagline

One private assistant for local models, projects, memory, tools, Windows, and iPhone.

Nebula is independently created by Jonard, a 14-year-old developer from Albania, with parental support for this submission. He directed the product, architecture, safety decisions, and real-device testing while using Codex with GPT-5.6 to accelerate implementation and verification.

## Category

Developer Tools

## Inspiration and Problem

Local language models can answer prompts, but they do not automatically become a dependable personal assistant. Users still need conversation storage, project context, memory, model routing, tools, permissions, diagnostics, and a safe way to reach the same assistant from another device.

Nebula makes the model replaceable and builds the operating layer around it.

## What It Does

Nebula connects to LM Studio on a Windows PC and presents one persistent assistant. It can stream chat, understand a selected project, route work between model roles, search reviewed memory, run cancellable terminal jobs, launch installed applications, research the web with source cards, and log verifiable actions. A private iPhone companion shares conversations and can stop runs or resolve approvals while the model and private data stay on the PC.

## How It Works

The desktop uses Tauri, Rust, React, and TypeScript. SQLite stores conversations, folders, search indexes, tasks, timeline events, diagnostics, and recovery state. The orchestrator combines skills, context, memory, model routing, and review triggers. Tools pass through execution modes and a permanent safety blocklist. LM Studio is the current local runtime adapter. The iPhone client uses React and Capacitor and connects through a paired private HTTPS bridge.

## Built With Codex and GPT-5.6

During Build Week, I used GPT-5.6 through Codex to extend Nebula across Windows and iPhone. Codex helped inspect the architecture, implement model routing, voice, terminal controls, mobile fixes, and web research, then test each change and turn failures into targeted repairs. I made the product and safety decisions while Codex accelerated implementation and verification.

The project existed before Build Week; [the dated Build Week record](BUILD_WEEK.md) clearly identifies the July 16-19 additions and commit evidence.

## Technologies

Tauri, Rust, React, TypeScript, Vite, SQLite, Capacitor, Swift, LM Studio, OpenAI-compatible local APIs, Tailscale Serve, Vitest, Playwright, QLoRA/PEFT, llama.cpp, and Codex with GPT-5.6.

## Challenges

- Keeping one conversation coherent while models load, switch, fail, or are cancelled
- Preventing late model/tool output after Stop
- Making iOS keyboard, safe-area, and unsigned IPA behavior reliable
- Giving terminal access without pretending Full Access can bypass catastrophic safety blocks
- Separating real live web results from model-invented source markup
- Evaluating fine-tunes honestly instead of treating training completion as proof of quality

## Accomplishments

- A working local desktop assistant with durable storage and real tools
- A native iPhone companion connected to the user's PC
- Session-scoped execution modes and cancellable command jobs
- Live web research and auditable source cards
- Reproducible benchmark and training pipelines
- A 2.0 release with public setup and rollback guidance

## What I Learned

The model is only one part of a reliable AI product. Cancellation, context boundaries, storage, truthful tool results, fallbacks, and understandable recovery paths matter just as much as generation quality. Small local models also need evaluation by capability; a fine-tune can improve tool use while making review behavior worse.

## What's Next

Runtime adapters beyond LM Studio, a built-in model/download manager, signed updates, stronger offline speech, vision, more robust model evaluations, and continued simplification for first-time users.

## Try It

- Repository: https://github.com/Jonardi123/nebula
- Windows release: https://github.com/Jonardi123/nebula/releases/latest
- Demo video: https://youtu.be/Z7kHWXRXMR8
- Codex `/feedback` session: `019f0ab3-ca05-7e30-acf5-a89ca7b67d06`

### Judge Setup

Install Nebula, start LM Studio's local server, load a compatible instruction/coding GGUF, and select it in Nebula. Models are downloaded separately and are not bundled. The app handles LM Studio being offline with a recoverable setup message.

## Eligibility Note

A parent or guardian will be the official eligible entrant/representative and will review the final entry, accept the terms, and submit it.
