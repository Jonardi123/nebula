# LM Studio Deployment

The validated Colab run produces:

- `nebula-gemma-7b-v1-Q4_K_M.gguf` - default local build for speed and lower memory use.
- `nebula-gemma-7b-v1-Q5_K_M.gguf` - optional quality-focused build.
- `nebula-gemma-7b-v1-eval-gate.json` - required proof that the adapter passed the fixed behavior gate.

Keep the existing Gemma model installed as a rollback. Import the Q4 file into LM Studio first, load it, and run Nebula Bench. Assign it to the **Daily** role only after identity, basic chat, tool JSON, and first-token latency checks pass. Qwen remains the Code role and the existing large model remains the Review role.

Nebula responses should identify as Nebula. Raw model IDs remain visible only in local Settings, Diagnostics, and developer logs.
