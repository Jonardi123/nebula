from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "training/scripts"))

import generate_synthetic_dataset  # noqa: E402
import generate_qwen3_dataset  # noqa: E402
import prepare_dataset  # noqa: E402
import train_qlora  # noqa: E402


class FakeGemmaTokenizer:
    """Character tokenizer sufficient to test offset-based loss masking."""

    def apply_chat_template(self, messages, tokenize=True, add_generation_prompt=False):
        del add_generation_prompt
        rendered = "<bos>" + "".join(f"<{message['role']}>{message['content']}</{message['role']}>" for message in messages)
        return [ord(character) for character in rendered] if tokenize else rendered

    def __call__(self, text, add_special_tokens=False, return_offsets_mapping=False):
        del add_special_tokens
        result = {"input_ids": [ord(character) for character in text]}
        if return_offsets_mapping:
            result["offset_mapping"] = [(index, index + 1) for index in range(len(text))]
        return result


class PipelineTests(unittest.TestCase):
    def test_standalone_safe_tool_request_is_accepted(self):
        item = {
            "messages": [
                {"role": "user", "content": "What time is it?"},
                {"role": "assistant", "content": '{"tool":"get_current_time","args":{}}'},
            ],
            "metadata": {"source": "synthetic", "sourceModelRole": "daily"},
        }
        example, reasons, flags = prepare_dataset.audit_example(item)
        self.assertIsNotNone(example)
        self.assertEqual(reasons, [])
        self.assertEqual(flags["malformed_tool"], 0)

    def test_assistant_only_mask_never_labels_user_text(self):
        encoded = train_qlora.encode_assistant_only(
            [
                {"role": "system", "content": "You are Nebula."},
                {"role": "user", "content": "hello"},
                {"role": "assistant", "content": "Hi. I'm Nebula."},
            ],
            FakeGemmaTokenizer(),
            1024,
        )
        labels = encoded["labels"]
        first_label = next(index for index, label in enumerate(labels) if label != train_qlora.IGNORE_INDEX)
        decoded_prefix = "".join(chr(value) for value in encoded["input_ids"][:first_label])
        self.assertIn("hello", decoded_prefix)
        self.assertTrue(all(label == train_qlora.IGNORE_INDEX for label in labels[:first_label]))
        self.assertGreater(encoded["supervised_tokens"], 0)

    def test_specialist_trace_is_audited_and_rejected(self):
        example = {
            "messages": [
                {"role": "system", "content": "Old prompt"},
                {"role": "user", "content": "Review this patch"},
                {"role": "assistant", "content": "One concrete issue."},
            ],
            "metadata": {"source": "local", "sourceModelRole": "review"},
        }
        accepted, reasons, flags = prepare_dataset.audit_example(example)
        self.assertIsNone(accepted)
        self.assertEqual(flags["route_mismatch"], 1)
        self.assertTrue(any("specialist" in reason for reason in reasons))

    def test_secret_is_removed_and_blocks_example(self):
        text, changed, blocked = prepare_dataset.sanitize("token=sk-abcdefghijklmnop1234")
        self.assertTrue(changed)
        self.assertTrue(blocked)
        self.assertNotIn("abcdefghijklmnop", text)

    def test_seed_set_has_at_least_three_hundred_unique_examples(self):
        examples = [
            *generate_synthetic_dataset.identity_examples(),
            *generate_synthetic_dataset.chat_examples(),
            *generate_synthetic_dataset.memory_examples(),
            *generate_synthetic_dataset.time_and_system_examples(),
            *generate_synthetic_dataset.file_examples(),
            *generate_synthetic_dataset.web_examples(),
            *generate_synthetic_dataset.failure_examples(),
            *generate_synthetic_dataset.handoff_examples(),
        ]
        fingerprints = {json.dumps(example["messages"], sort_keys=True) for example in examples}
        self.assertGreaterEqual(len(fingerprints), 300)

    def test_qwen3_cyber_seeds_are_unique_and_defensive(self):
        examples = generate_qwen3_dataset.cyber_examples()
        fingerprints = {json.dumps(example["messages"], sort_keys=True) for example in examples}
        categories = {example["metadata"]["category"] for example in examples}
        self.assertEqual(len(fingerprints), len(examples))
        self.assertGreaterEqual(len(examples), 50)
        self.assertIn("cyber_secure_code", categories)
        self.assertIn("cyber_incident_response", categories)
        self.assertIn("cyber_safety_boundary", categories)

    def test_qwen3_variants_do_not_cross_dataset_splits(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            with patch("sys.argv", ["generate_qwen3_dataset.py", "--output-dir", str(output)]):
                self.assertEqual(generate_qwen3_dataset.main(), 0)
            train_groups = {
                json.loads(line)["metadata"]["group_id"]
                for line in (output / "train.jsonl").read_text(encoding="utf-8").splitlines()
            }
            validation_groups = {
                json.loads(line)["metadata"]["group_id"]
                for line in (output / "validation.jsonl").read_text(encoding="utf-8").splitlines()
            }
            self.assertFalse(train_groups & validation_groups)


if __name__ == "__main__":
    unittest.main()
