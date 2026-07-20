# Nebula Unified 100K v1

This corpus targets `Qwen/Qwen2.5-Coder-7B-Instruct` as a single local Nebula model for chat, code, tools, project work, defensive security, and authorized reverse engineering.

## Honest provenance

The initial 100,000 rows are deterministic candidate scenarios composed from reviewed response templates. They are **not** 100,000 individually human-reviewed answers and are intentionally blocked from training when answer diversity is too low. Treat the candidate bank as input to a chunked generation/review pass, then use the sample review pack and held-out benchmarks as quality gates.

## Mix and splits

- 32,000 authorized reverse-engineering examples
- 15,000 tool and agent workflows
- 13,000 coding and debugging examples
- 9,000 defensive cybersecurity examples
- 7,000 failure and honesty examples
- 6,000 code review and architecture examples
- 5,000 general chat examples
- 4,000 memory and context examples
- 3,000 web research examples
- 3,000 identity, voice, and mobile examples
- 3,000 planning and routing examples

The generator writes exactly 90,000 training rows, 5,000 validation rows, and 5,000 hidden rows. Each split uses distinct scenario vocabulary and family IDs. The hidden split is never included in the Colab training bundle.

## Generate and validate

```powershell
python training/scripts/generate_nebula_100k.py
python training/scripts/validate_nebula_100k.py `
  --heldout training/evals/qwen_coder_behavior.jsonl `
  --heldout training/evals/qwen_coder_stress.jsonl `
  --heldout training/evals/qwen3_cyber_behavior.jsonl
python training/scripts/create_nebula_training_stages.py
```

Generated JSONL files are ignored by Git because the train split is roughly 180 MB. The scripts, config, and documentation are the reproducible source of truth. `validation-report.json` must say both `passed: true` and `trainingReady: true` before the bundle builder will package a training stage.

## Chunked answer generation and review

The candidate generator intentionally does not manufacture superficial paraphrases just to pass a diversity metric. Use an OpenAI-compatible teacher and a separate stronger reviewer in resumable chunks:

```powershell
python training/scripts/review_nebula_candidates.py `
  --input training/nebula-100k/train.jsonl `
  --output training/nebula-100k-reviewed/train.jsonl `
  --teacher-model "teacher-model-id" `
  --reviewer-model "reviewer-model-id" `
  --limit 500
```

Rerun the same command to continue; completed source lines are recorded in the review log and skipped. Provider credentials, when needed, come only from `NEBULA_REVIEW_API_KEY`. Do not place keys in arguments, notebooks, datasets, or logs.

Run separate jobs for `train.jsonl`, `validation.jsonl`, and `hidden.jsonl`, writing the same filenames under `training/nebula-100k-reviewed/`. If a reviewer configuration improves, add `--retry-rejected`. Then validate that reviewed directory and build the first pilot only after `trainingReady` becomes true:

```powershell
python training/scripts/validate_nebula_100k.py `
  --data-dir training/nebula-100k-reviewed `
  --heldout training/evals/qwen_coder_behavior.jsonl `
  --heldout training/evals/qwen_coder_stress.jsonl `
  --heldout training/evals/qwen3_cyber_behavior.jsonl
python training/scripts/build_nebula_100k_bundle.py --stage 5000
```

Using the same 7B model as both teacher and reviewer is suitable only for pipeline smoke tests. A serious production pass needs an independent stronger reviewer plus human inspection of the deterministic sample pack. Contract categories such as exact tool JSON remain on reviewed templates by default.

## Training order

Do not start with all 90,000 training rows.

1. Complete the independent review pass and make the training-readiness gate pass.
2. Train the 5K pilot and benchmark identity, tool JSON, coding, review, safety, and reverse-engineering behavior.
3. If it improves without regressions, resume or restart with the 20K stage.
4. Repeat at 50K.
5. Run the full 90K split only after the smaller stages pass.

The included QLoRA config is conservative for a Tesla T4: 4-bit NF4, LoRA rank 16, batch size 1, gradient accumulation 16, 1536-token context, and one epoch. A full 90K run can take many hours or days on a free T4 and may exceed a single Colab session.

## Safety boundary

Reverse-engineering rows cover user-owned or explicitly authorized artifacts, static analysis, crash investigation, file formats, protocol documentation, defensive triage, and uncertainty reporting. They do not teach credential theft, persistence, evasion, destructive payloads, exfiltration, security disabling, or attacks on third parties.

## Deployment gate

The adapter is not ready for Nebula merely because training completes. Compare base and tuned models on all committed eval suites, inspect raw failures, test native tool calling, merge the adapter, quantize it, benchmark speed on the target PC, and keep the original model installed for rollback.
