# Nebula Build Week Record

## Scope

Nebula existed before OpenAI Build Week. It already had a Tauri/React desktop shell, LM Studio chat, project tools, memory, and an evolving agent architecture. The submission demonstrates that foundation plus a concentrated July 16-19, 2026 expansion built with GPT-5.6 through Codex.

## What Changed During Build Week

| Date | Evidence | Addition |
| --- | --- | --- |
| July 16 | `13d762c`, `ab65d58` | Prepared the native iOS companion and corrected unsigned IPA packaging. |
| July 16 | `a0a9db9`, `3b439ff`, `3cfbe8d`, `8b32ffd` | Upgraded the mobile experience, refresh behavior, standalone viewport, and composer placement. |
| July 17 | `f1e0903` | Added local Qwen3 benchmark profiling. |
| July 17 | `0709c6c`, `8a5bb6f` | Built and expanded the defensive-security training pipeline to 4,000 reviewed examples. |
| July 19 | `b15c4a7`, `d21e4b3` | Improved iOS fullscreen/reliability and repaired the native voice plugin build. |
| July 19 | `7a37f3d` | Shipped Nebula 2.0 Black Matter with terminal controls, app launching, execution modes, themes, and auditing. |
| July 19 | `45a817b` | Removed the fake mobile streaming placeholder and reduced unnecessary warm-model delay. |
| July 19 | `5d55793` | Made web research use live results and reject hallucinated source markup. |

The submission-preparation commit adds public documentation, privacy-safe mobile setup, release verification, screenshots, and the final Build Week video chapter.

## How Codex and GPT-5.6 Were Used

Codex inspected the existing architecture, traced bugs across React, Rust, Tauri, Capacitor, and LM Studio, implemented scoped changes, ran builds and tests, interpreted failures, and turned them into targeted repairs. It also helped create validation tooling and the submission package.

The human creator chose the product direction, approved safety boundaries, selected models and tradeoffs, tested the app on physical hardware, and decided which generated changes to keep. Hidden chain-of-thought is never recorded or shown; the product exposes only actions, tool calls, results, and safe summaries.

## Existing Foundation

- Windows-first Tauri/React application
- LM Studio OpenAI-compatible integration
- Project files, memory, tools, and approvals
- Agent and skills concepts
- Early desktop interface and voice experiments

## Build Week Result

- One assistant spanning Windows and an iPhone companion
- More reliable streaming, model readiness, cancellation, and error handling
- A stronger terminal and execution-safety system
- Live web research with source validation
- Reproducible local-model benchmarking and fine-tuning tooling
- Public documentation and a privacy-safe setup path

## Verification

Run:

```powershell
npm.cmd run lint
npm.cmd run test
npm.cmd run build
cargo test --manifest-path src-tauri/Cargo.toml
npm.cmd run tauri:build
```

Large datasets, weights, adapters, IPA files, private endpoints, memory, and local logs are intentionally not part of the repository.
