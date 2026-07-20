# Nebula Architecture

This document records the architecture that exists today and the boundaries Nebula should preserve while growing into a complete local AI platform.

## Current System Map

| System | Current implementation | Notes |
| --- | --- | --- |
| User interface | React components under `src/components`, coordinated by `App.tsx` | Feature panels are loaded on demand. Chat remains the primary shell. |
| Conversations | `storage.ts`, Rust `storage.rs`, SQLite with a legacy adapter | Supports folders, indexed search, streamed persistence, migration backup, and corrupt-data recovery. |
| Projects and memory | `workspaceAwareness.ts`, `contextEngine.ts`, `unifiedMemory.ts`, Rust filesystem commands | Context is assembled per request and project data stays local. |
| Model manager | `modelManager.ts` | Owns warm/load/switch/idle-unload behavior and lifecycle events. |
| Inference router | `modelRouter.ts`, `modelOrchestrator.ts`, `agent.ts` | Chooses daily/code/review roles and keeps the user-facing identity as Nebula. |
| Runtime integration | `lmstudio.ts` plus LM Studio Tauri commands | LM Studio is the implemented local runtime. 9Router and OpenRouter are optional remote providers. |
| Tool execution | `tools.ts`, `commandRunner.ts`, Rust Tauri commands | Tool results are explicit and commands run without automatic elevation. |
| Permissions and safety | `commandSafety.ts`, approval/permission components, path validation in Rust | Destructive/security-sensitive behavior remains blocked. |
| Diagnostics | logger, timeline, replay, model stats, orchestrator diagnostics | Records actions and summaries, never hidden reasoning. |
| Packaging | Tauri configuration and Windows bundle | Models are not bundled with the installer. |

## Request Flow

1. The UI submits a message and attachments to `runAgentLoop`.
2. The orchestrator selects skills and a model role.
3. The model manager resolves and loads the requested model when needed.
4. The context engine injects relevant memory and workspace context.
5. The runtime client sends the request and streams the response.
6. Tool requests pass through permission and safety checks before execution.
7. Conversation, timeline, task, model, and training diagnostics are persisted locally.

## Current Technical Debt

1. `App.tsx` and the Rust `lib.rs` remain large coordinators. New behavior should move behind existing libraries or narrowly scoped services instead of adding more inline logic.
2. Conversations and namespaced durable documents use SQLite, while some low-risk preferences and legacy feature stores still use local storage. Those remaining stores should move through the existing `DocumentRepository` boundary as their schemas stabilize.
3. `lmstudio.ts` contains both provider selection and LM Studio-specific transport behavior. Runtime adapters should eventually own discovery, inference, load, unload, and health operations.
4. Agent cancellation now crosses inference, commands, approvals, and most orchestration work. LM Studio model loading cannot always be cancelled server-side, so abandoned load results must continue to be ignored by run ID.
5. The Rust backend is a single module. Split it by filesystem, command, model runtime, web, screen, and system domains before adding a download manager.
6. Update delivery is not implemented. It must use signed release artifacts and an explicit user-facing update policy.

## Target Boundaries

Future work should depend on interfaces, not a provider name:

- `RuntimeAdapter`: discover, import, load, unload, infer, cancel, and report resource use.
- `ModelCatalog`: search metadata from Hugging Face or another catalog without controlling downloads.
- `DownloadManager`: enqueue, pause, resume, cancel, verify, update, and remove model artifacts.
- `ModelRepository`: persist installed-model metadata independently of runtime state.
- `InferenceRouter`: select a model capability and runtime without owning transport details.
- `ConversationRepository`: persist folders, messages, search indexes, and recovery snapshots.
- `ToolExecutor`: execute validated tool requests behind the permissions layer.
- `DiagnosticsSink`: receive structured lifecycle, performance, failure, and recovery events.

The official fine-tuned Qwen 1.5B model is a recommended catalog entry, not a hard dependency. First launch will later offer the official model, other models, local import, provider connection, or skipping setup.

## Prioritized Roadmap

### Stage 1: Stability and startup

- Lazy-load secondary panels.
- Use lightweight provider/model discovery for recurring health checks.
- Preserve corrupt conversation payloads before recovery.
- Keep active inference and command cancellation reliable.
- Add regression tests for persistence, navigation, routing, and the composer.

### Stage 2: Durable storage and cancellation (implemented foundation)

- Continue migrating secondary feature stores through `DocumentRepository`.
- Expand corruption and interrupted-session recovery tests.
- Preserve run-ID suppression for runtime operations that cannot be cancelled remotely.
- Add finer user controls for diagnostic retention and redacted export.

### Stage 3: Runtime adapters

- Extract LM Studio behind `RuntimeAdapter` without changing user behavior.
- Add llama.cpp and Ollama adapters only after contract tests exist.
- Keep cloud providers optional and visibly distinct from local execution.
- Add capability and hardware-fit metadata to model records.

### Stage 4: Downloads and model discovery

- Add a resumable download queue with checksums and atomic finalization.
- Add Hugging Face browsing and GGUF variant selection.
- Add import, verification, update, and deletion flows.
- Keep all model files outside the installer and outside application binaries.

### Stage 5: Updates and recovery

- Add signed application updates with explicit consent and rollback guidance.
- Persist in-progress task recovery records before long operations.
- Add startup crash markers and a safe-mode launch that disables optional panels and animations.

## Performance Rules

- Do not load feature panels, model metadata, or project indexes before they are needed.
- Do not run inference as a connectivity probe.
- Bound stored text, logs, search results, and context before persistence or injection.
- Never block React rendering on model load, filesystem indexing, or network work.
- Record load time, first-token time, total time, errors, and cancellation separately.
