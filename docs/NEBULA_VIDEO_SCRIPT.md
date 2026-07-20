# Nebula Build Week Demo

Target: approximately 2:25, strictly under 3:00. The final master is 1920x1080 H.264 with AAC audio, bottom-centered captions, Ryan narration, and a low-volume locally generated ambient bed.

## Timeline

### 0:00 - Cold Open

Nebula startup, desktop chat, voice, and iPhone companion.

> I wanted an AI assistant that was actually mine. Not another browser tab, and not a chatbot pretending it could use my computer. So I built Nebula: a local AI platform running on my PC.

### Architecture

Desktop workspace, model status, project context, memory, tools, and safety.

> Nebula uses Tauri, Rust, React, and TypeScript. LM Studio runs the models; Nebula owns the conversation, project context, memory, tools, and safety. Models can change without resetting the assistant, and every action stays visible.

### Built With Codex + GPT-5.6

Generated chapter card with dated Build Week milestones, diffs, and verified changes.

> During Build Week, I used GPT-5.6 through Codex to extend Nebula across Windows and iPhone. Codex helped inspect the architecture, implement model routing, voice, terminal controls, mobile fixes, and web research, then test each change and turn failures into targeted repairs. I made the product and safety decisions while Codex accelerated implementation and verification.

### Model Routing

LM Studio model discovery, role routing, single-model mode, and measured load information.

> Different work deserves different brains. Nebula routes chat, coding, and review automatically, or locks every task to one model. It discovers local models and configures them without exposing raw identifiers. This Qwen 2.5 Coder 7B loaded in under six seconds, using about 4.9 gigabytes of video memory.

### Honest Evaluation

Compact benchmark table and before/after fine-tuning results.

> I benchmark instead of guessing. The untouched 7B passed every coding and project-context case, scoring sixteen out of twenty-five overall. An earlier tuned 1.5B model climbed from twenty to sixty-five percent, including twenty of twenty-one tool-use tests. The numbers stay honest, even when the result is not perfect.

### Mobile

Native iPhone companion, shared chat, voice, Stop, and approvals.

> Nebula also reaches my iPhone through a private companion app. It shares conversations, attachments, voice, stop controls, and approvals, while the models and private data remain on my computer, not the public internet.

### Close

Return to the main composer and Nebula wordmark.

> One assistant. Local models. Desktop and mobile. This is Nebula, and this is only version one.

## Privacy Checklist

- No private hostnames, pairing codes, device IDs, email addresses, tokens, or local user paths.
- No model weights, private memory, or personal conversation history.
- Only licensed, original, or locally generated media.
- Build Week chapter names Codex and GPT-5.6 explicitly.
