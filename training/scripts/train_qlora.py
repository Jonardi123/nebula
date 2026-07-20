#!/usr/bin/env python3
"""Train Nebula Gemma with 4-bit QLoRA and explicit assistant-only labels."""

from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path
from typing import Any


IGNORE_INDEX = -100


def project_root() -> Path:
    return Path(__file__).resolve().parents[2]


def resolve_path(value: str | Path) -> Path:
    path = Path(value)
    return path if path.is_absolute() else project_root() / path


def normalize_for_gemma(messages: list[dict[str, str]]) -> list[dict[str, str]]:
    systems = [message["content"].strip() for message in messages if message.get("role") == "system" and message.get("content", "").strip()]
    turns: list[dict[str, str]] = []
    for message in messages:
        role = message.get("role")
        content = message.get("content", "").strip()
        if not content or role == "system":
            continue
        normalized_role = "user" if role == "tool" else role
        if normalized_role not in {"user", "assistant"}:
            continue
        if role == "tool":
            content = f"Tool result:\n{content}"
        if turns and turns[-1]["role"] == normalized_role:
            turns[-1]["content"] += f"\n\n{content}"
        else:
            turns.append({"role": normalized_role, "content": content})

    if not turns or turns[0]["role"] != "user":
        raise ValueError("Gemma training conversations must begin with a user turn")
    if systems:
        system_text = "\n\n".join(systems)
        turns[0]["content"] = f"[NEBULA OPERATING CONTRACT]\n{system_text}\n\n[USER REQUEST]\n{turns[0]['content']}"
    if not any(turn["role"] == "assistant" for turn in turns):
        raise ValueError("Conversation has no assistant response")
    return turns


def encode_assistant_only(messages: list[dict[str, str]], tokenizer, max_length: int) -> dict[str, list[int] | int]:
    turns = normalize_for_gemma(messages)
    annotated: list[dict[str, str]] = []
    markers: list[tuple[str, str]] = []
    for index, turn in enumerate(turns):
        if turn["role"] != "assistant":
            annotated.append(turn)
            continue
        start = f"<|nebula_assistant_start_{index}|>"
        end = f"<|nebula_assistant_end_{index}|>"
        markers.append((start, end))
        annotated.append({"role": "assistant", "content": f"{start}{turn['content']}{end}"})

    rendered = tokenizer.apply_chat_template(annotated, tokenize=False, add_generation_prompt=False)
    clean_parts: list[str] = []
    assistant_spans: list[tuple[int, int]] = []
    source_cursor = 0
    clean_length = 0
    for start_marker, end_marker in markers:
        start_index = rendered.find(start_marker, source_cursor)
        end_index = rendered.find(end_marker, start_index + len(start_marker))
        if start_index < 0 or end_index < 0:
            raise ValueError("Chat template altered assistant span markers; masking would be unsafe")
        prefix = rendered[source_cursor:start_index]
        content = rendered[start_index + len(start_marker) : end_index]
        clean_parts.extend((prefix, content))
        clean_length += len(prefix)
        span_start = clean_length
        clean_length += len(content)
        assistant_spans.append((span_start, clean_length))
        source_cursor = end_index + len(end_marker)
    clean_parts.append(rendered[source_cursor:])
    clean_text = "".join(clean_parts)

    encoded = tokenizer(clean_text, add_special_tokens=False, return_offsets_mapping=True)
    input_ids = list(encoded["input_ids"])
    offsets = list(encoded["offset_mapping"])
    labels = [
        token_id
        if any(token_start < span_end and token_end > span_start for span_start, span_end in assistant_spans)
        else IGNORE_INDEX
        for token_id, (token_start, token_end) in zip(input_ids, offsets)
    ]

    if len(input_ids) > max_length:
        input_ids = input_ids[-max_length:]
        labels = labels[-max_length:]
    supervised_tokens = sum(label != IGNORE_INDEX for label in labels)
    if supervised_tokens == 0:
        raise ValueError("Conversation has no supervised assistant tokens after truncation")
    return {
        "input_ids": input_ids,
        "attention_mask": [1] * len(input_ids),
        "labels": labels,
        "supervised_tokens": supervised_tokens,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, default=Path("training/configs/gemma-7b-nebula-qlora.json"))
    parser.add_argument("--output-dir", type=Path, help="Override output_dir, useful for mounted Google Drive")
    parser.add_argument("--train-file", type=Path, help="Override train_file for a staged pilot")
    parser.add_argument("--validation-file", type=Path, help="Override validation_file")
    parser.add_argument("--resume", action="store_true", help="Resume from the latest checkpoint in output_dir")
    args = parser.parse_args()
    config_path = resolve_path(args.config)
    config: dict[str, Any] = json.loads(config_path.read_text(encoding="utf-8"))

    import torch
    from datasets import load_dataset
    from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig, DataCollatorForSeq2Seq, Trainer, TrainingArguments, set_seed
    from transformers.trainer_utils import get_last_checkpoint

    if not torch.cuda.is_available():
        raise SystemExit("A CUDA GPU is required. Use the included Google Colab notebook; do not run this job on the local AMD/CPU setup.")

    seed = int(config.get("seed", 42))
    set_seed(seed)
    output_dir = args.output_dir.resolve() if args.output_dir else resolve_path(config["output_dir"])
    output_dir.mkdir(parents=True, exist_ok=True)
    train_file = args.train_file.resolve() if args.train_file else resolve_path(config["train_file"])
    validation_file = args.validation_file.resolve() if args.validation_file else resolve_path(config["validation_file"])
    if not train_file.exists() or not validation_file.exists():
        raise SystemExit("Prepared train/validation JSONL files are missing. Run prepare_dataset.py first.")

    base_model = config["base_model"]
    tokenizer = AutoTokenizer.from_pretrained(base_model, use_fast=True, token=os.environ.get("HF_TOKEN") or None)
    if not tokenizer.chat_template:
        raise SystemExit("The selected tokenizer has no chat template; assistant-only masking cannot continue safely.")
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = "right"

    bf16 = bool(torch.cuda.is_bf16_supported())
    compute_dtype = torch.bfloat16 if bf16 else torch.float16
    quantization = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_use_double_quant=True,
        bnb_4bit_compute_dtype=compute_dtype,
    )
    model = AutoModelForCausalLM.from_pretrained(
        base_model,
        quantization_config=quantization,
        device_map="auto",
        torch_dtype=compute_dtype,
        token=os.environ.get("HF_TOKEN") or None,
    )
    model.config.use_cache = False
    model.config.pad_token_id = tokenizer.pad_token_id
    model = prepare_model_for_kbit_training(model, use_gradient_checkpointing=True)
    model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
    lora = LoraConfig(
        r=int(config["lora_r"]),
        lora_alpha=int(config["lora_alpha"]),
        lora_dropout=float(config["lora_dropout"]),
        bias="none",
        task_type="CAUSAL_LM",
        target_modules=config.get("target_modules", "all-linear"),
    )
    model = get_peft_model(model, lora)

    dataset = load_dataset("json", data_files={"train": str(train_file), "validation": str(validation_file)})
    max_length = int(config["max_length"])
    original_columns = dataset["train"].column_names

    def tokenize(example: dict[str, Any]) -> dict[str, Any]:
        try:
            return {**encode_assistant_only(example["messages"], tokenizer, max_length), "mask_error": ""}
        except (KeyError, TypeError, ValueError) as error:
            return {"input_ids": [], "attention_mask": [], "labels": [], "supervised_tokens": 0, "mask_error": str(error)}

    tokenized = dataset.map(tokenize, remove_columns=original_columns, desc="Applying assistant-only labels")
    mask_errors = [row["mask_error"] for split in tokenized.values() for row in split if row["mask_error"]]
    tokenized = tokenized.filter(lambda row: row["supervised_tokens"] > 0, desc="Removing invalid masked examples")
    tokenized = tokenized.remove_columns(["supervised_tokens", "mask_error"])
    if not len(tokenized["train"]):
        raise SystemExit(f"No train examples survived assistant masking. First errors: {mask_errors[:3]}")

    has_validation = len(tokenized["validation"]) > 0
    training_args = TrainingArguments(
        output_dir=str(output_dir),
        run_name=str(config.get("run_name", "nebula-gemma-7b-v1")),
        per_device_train_batch_size=int(config["per_device_train_batch_size"]),
        per_device_eval_batch_size=int(config["per_device_eval_batch_size"]),
        gradient_accumulation_steps=int(config["gradient_accumulation_steps"]),
        learning_rate=float(config["learning_rate"]),
        num_train_epochs=float(config["num_train_epochs"]),
        weight_decay=float(config.get("weight_decay", 0.0)),
        max_grad_norm=float(config.get("max_grad_norm", 0.3)),
        warmup_ratio=float(config["warmup_ratio"]),
        lr_scheduler_type="cosine",
        bf16=bf16,
        fp16=not bf16,
        tf32=torch.cuda.get_device_capability(0)[0] >= 8,
        gradient_checkpointing=True,
        gradient_checkpointing_kwargs={"use_reentrant": False},
        logging_steps=int(config["logging_steps"]),
        logging_strategy="steps",
        eval_strategy="epoch" if has_validation else "no",
        save_strategy="epoch",
        load_best_model_at_end=has_validation,
        metric_for_best_model="eval_loss" if has_validation else None,
        greater_is_better=False if has_validation else None,
        save_total_limit=2,
        report_to="none",
        optim="paged_adamw_8bit",
        seed=seed,
        data_seed=seed,
        remove_unused_columns=False,
    )
    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=tokenized["train"],
        eval_dataset=tokenized["validation"] if has_validation else None,
        data_collator=DataCollatorForSeq2Seq(tokenizer=tokenizer, padding=True, label_pad_token_id=IGNORE_INDEX),
    )
    resume_checkpoint = get_last_checkpoint(str(output_dir)) if args.resume else None
    train_result = trainer.train(resume_from_checkpoint=resume_checkpoint)
    trainer.save_model(str(output_dir))
    trainer.save_state()
    tokenizer.save_pretrained(str(output_dir))

    evaluation = trainer.evaluate() if has_validation else {}
    if "eval_loss" in evaluation:
        evaluation["perplexity"] = math.exp(min(float(evaluation["eval_loss"]), 20.0))
    report = {
        "runName": config.get("run_name"),
        "baseModel": base_model,
        "adapterDir": str(output_dir),
        "gpu": torch.cuda.get_device_name(0),
        "cuda": torch.version.cuda,
        "computeDtype": str(compute_dtype),
        "trainExamples": len(tokenized["train"]),
        "validationExamples": len(tokenized["validation"]),
        "assistantOnlyLoss": True,
        "maskErrorsRemoved": len(mask_errors),
        "trainMetrics": train_result.metrics,
        "evaluation": evaluation,
        "config": config,
        "logHistory": trainer.state.log_history,
    }
    (output_dir / "nebula-training-report.json").write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
    print(json.dumps({key: value for key, value in report.items() if key not in {"config", "logHistory"}}, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
