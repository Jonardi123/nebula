#!/usr/bin/env python3
"""Generate deterministic, reviewed-template Gemma examples for Nebula v1."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def project_root() -> Path:
    return Path(__file__).resolve().parents[2]


def system_prompt() -> str:
    return (project_root() / "training/configs/nebula-gemma-system-prompt.txt").read_text(encoding="utf-8").strip()


def make_example(prompt: str, assistant: str, category: str, *, tool: str | None = None, args: dict[str, Any] | None = None, result: str | None = None) -> dict[str, Any]:
    messages: list[dict[str, str]] = [
        {"role": "system", "content": system_prompt()},
        {"role": "user", "content": prompt},
    ]
    if tool:
        messages.append({"role": "assistant", "content": json.dumps({"tool": tool, "args": args or {}}, separators=(",", ":"))})
        messages.append({"role": "tool", "content": result or json.dumps({"ok": False, "tool": tool, "error": "No result supplied."})})
    messages.append({"role": "assistant", "content": assistant})
    return {
        "messages": messages,
        "metadata": {
            "source": "synthetic",
            "sourceModelRole": "daily",
            "gemmaApproved": True,
            "eligible": True,
            "qualityScore": 100,
            "tags": ["gemma-v1", category],
        },
    }


def make_tool_request_example(prompt: str, tool: str, args: dict[str, Any], category: str) -> dict[str, Any]:
    """Teach the first turn independently so the model cannot skip to a fake result."""
    return make_example(
        prompt,
        json.dumps({"tool": tool, "args": args}, separators=(",", ":")),
        f"{category}-request",
    )


def identity_examples() -> list[dict[str, Any]]:
    questions = [
        "Who are you?",
        "What should I call you?",
        "Are you Gemma?",
        "Are you Qwen?",
        "Which company made the assistant I am speaking to?",
        "Tell me your identity in one sentence.",
        "What model are you?",
        "Is this GPT?",
        "Are you just an LM Studio model?",
        "What is your name?",
        "Introduce yourself briefly.",
        "Which AI brain is answering right now?",
    ]
    variants = [
        "I'm Nebula, your local AI assistant.",
        "I'm Nebula. I help you work, learn, and solve problems on your computer.",
        "You are talking to Nebula, your local assistant.",
    ]
    return [make_example(f"{question} Keep it {tone}.", variants[index % len(variants)], "identity") for index, (question, tone) in enumerate((q, t) for q in questions for t in ("brief", "simple", "direct"))]


def chat_examples() -> list[dict[str, Any]]:
    tasks = [
        "clean my desk",
        "start studying",
        "plan tomorrow",
        "organize project notes",
        "prepare for a meeting",
        "write a short checklist",
        "compare two options",
        "summarize a long message",
        "break down a difficult task",
        "choose what to work on first",
        "prepare questions for a teacher",
        "outline a presentation",
        "plan a focused hour",
        "review today's priorities",
        "turn an idea into next steps",
    ]
    prompts = [
        "Help me {task}. Give me only the first useful step.",
        "I need to {task}. Keep your advice to two sentences.",
        "Make {task} feel manageable. Be concise.",
    ]
    answers = [
        "Start by defining the smallest visible result you want, then spend ten focused minutes on only that.",
        "Write down the outcome you need and choose one action you can finish now. Ignore the rest until that action is done.",
        "Pick the easiest concrete starting point and complete it before expanding the plan.",
    ]
    return [make_example(template.format(task=task), answers[index], "chat") for task in tasks for index, template in enumerate(prompts)]


def memory_examples() -> list[dict[str, Any]]:
    topics = [
        "my preferred coding style",
        "the Nebula project setup",
        "how I like answers formatted",
        "the last build fix",
        "my daily model preference",
        "the project package manager",
        "my voice language",
        "the last successful command",
        "the active project goal",
        "my UI preferences",
        "the previous debugging lesson",
        "the current model roles",
        "my favorite workflow",
        "the last project decision",
        "what we learned from the latest error",
    ]
    examples: list[dict[str, Any]] = []
    for topic in topics:
        for wording in ("What do you remember about {topic}?", "Check memory for {topic}.", "Before answering, look up {topic} in memory."):
            query = topic.replace("my ", "").replace("the ", "")
            result = json.dumps({"ok": True, "tool": "search_memory", "output": [{"file": "preferences.md", "content": f"Saved note about {topic}."}]})
            prompt = wording.format(topic=topic)
            args = {"query": query}
            examples.append(make_tool_request_example(prompt, "search_memory", args, "memory"))
            examples.append(make_example(prompt, f"Memory has a saved note about {topic}. I can use it as context, but I won't invent details beyond that note.", "memory-result", tool="search_memory", args=args, result=result))
    return examples


def time_and_system_examples() -> list[dict[str, Any]]:
    examples: list[dict[str, Any]] = []
    time_prompts = ["What time is it?", "Tell me the current local time.", "Give me today's date and time.", "Is it morning or evening here?", "Check the clock for me.", "What day is it?", "Give me the time in one sentence.", "Check my local date.", "What's the current timestamp?", "Tell me the weekday."]
    for prompt in time_prompts:
        for suffix in ("", " Do not guess."):
            request = prompt + suffix
            examples.append(make_tool_request_example(request, "get_current_time", {}, "time"))
            examples.append(make_example(request, "The confirmed local time is 3:15 PM on Tuesday, July 14, 2026.", "time-result", tool="get_current_time", args={}, result=json.dumps({"ok": True, "tool": "get_current_time", "output": "2026-07-14T15:15:00+02:00"})))
    system_prompts = ["How much memory is available?", "Check basic system information.", "Which operating system is this?", "Show a short PC status.", "How much RAM does this computer have?", "Check the machine architecture.", "Give me a one-line system summary.", "Is this Windows?", "Check system details without changing anything.", "Read the current device information."]
    for prompt in system_prompts:
        for suffix in ("", " Keep it concise."):
            request = prompt + suffix
            examples.append(make_tool_request_example(request, "get_system_info", {}, "system"))
            examples.append(make_example(request, "This is a 64-bit Windows system with 24 GB of RAM. That result came from the local system tool.", "system-result", tool="get_system_info", args={}, result=json.dumps({"ok": True, "tool": "get_system_info", "output": {"os": "Windows", "architecture": "x64", "memoryGb": 24}})))
    return examples


def file_examples() -> list[dict[str, Any]]:
    files = ["README.md", "package.json", "src/App.tsx", "src/main.tsx", "Cargo.toml", "tauri.conf.json", "CHANGELOG.md", "docs/setup.md", "src/lib/settings.ts", "src/lib/modelRouter.ts", "LICENSE", ".gitignore", "vite.config.ts", "tsconfig.json", "src/styles/globals.css"]
    examples: list[dict[str, Any]] = []
    for path in files:
        for wording in ("Read {path} and summarize it without editing.", "What is {path} for? Read it first."):
            result = json.dumps({"ok": True, "tool": "read_file", "output": f"Sample contents from {path}: project configuration and documentation."})
            prompt = wording.format(path=path)
            args = {"path": path}
            examples.append(make_tool_request_example(prompt, "read_file", args, "read-file"))
            examples.append(make_example(prompt, f"{path} contains project configuration or documentation. I read the supplied tool result and did not edit the file.", "read-file-result", tool="read_file", args=args, result=result))
    folders = ["src", "src/lib", "src/components", "training", "docs", "memory", "public", "src-tauri", "tests", ".github"]
    for folder in folders:
        for wording in ("List the files in {folder}.", "Show me what is inside {folder} without changing it."):
            result = json.dumps({"ok": True, "tool": "list_files", "output": [f"{folder}/example-one", f"{folder}/example-two"]})
            prompt = wording.format(folder=folder)
            args = {"path": folder}
            examples.append(make_tool_request_example(prompt, "list_files", args, "list-files"))
            examples.append(make_example(prompt, f"The tool found two entries in {folder}: example-one and example-two.", "list-files-result", tool="list_files", args=args, result=result))
    return examples


def web_examples() -> list[dict[str, Any]]:
    topics = ["the latest TypeScript release", "current LM Studio documentation", "today's weather", "a recently updated library API", "current Windows support policy", "the newest Tauri release notes", "a current exchange rate", "today's technology headlines", "recent security guidance", "current package documentation", "an active product price", "today's sports schedule", "current travel requirements", "a recently changed law", "the latest model documentation"]
    examples: list[dict[str, Any]] = []
    for topic in topics:
        for wording in ("Find {topic}.", "I need up-to-date information about {topic}.", "Check the web for {topic} and cite the source."):
            result = json.dumps({"ok": True, "tool": "web_search", "output": [{"title": "Authoritative source", "url": "https://example.com/source", "snippet": f"Current information about {topic}.", "date": "2026-07-10"}]})
            prompt = wording.format(topic=topic)
            args = {"query": topic, "maxResults": 4}
            examples.append(make_tool_request_example(prompt, "web_search", args, "web"))
            examples.append(make_example(prompt, f"The search returned an authoritative source about {topic}. Source: https://example.com/source (checked 2026-07-10).", "web-result", tool="web_search", args=args, result=result))
    return examples


def failure_examples() -> list[dict[str, Any]]:
    requests = [
        ("Check the time, but tell me honestly if the tool fails.", "get_current_time", {}),
        ("Search memory for my old preference.", "search_memory", {"query": "old preference"}),
        ("Read README.md.", "read_file", {"path": "README.md"}),
        ("List the src folder.", "list_files", {"path": "src"}),
        ("Check system information.", "get_system_info", {}),
        ("Search the web for current documentation.", "web_search", {"query": "current documentation"}),
        ("Fetch this public page: https://example.com/docs", "web_fetch", {"url": "https://example.com/docs"}),
        ("Look in memory for the deployment note.", "search_memory", {"query": "deployment note"}),
        ("Read a missing file called notes.md.", "read_file", {"path": "notes.md"}),
        ("List a folder called missing-folder.", "list_files", {"path": "missing-folder"}),
    ]
    examples: list[dict[str, Any]] = []
    for prompt, tool, args in requests:
        for reason in ("The requested resource was not found.", "The local tool is temporarily unavailable.", "Permission was denied."):
            result = json.dumps({"ok": False, "tool": tool, "error": reason})
            examples.append(make_tool_request_example(prompt, tool, args, "tool-failure"))
            examples.append(make_example(prompt, f"I couldn't confirm that result because the tool reported: {reason} I have not claimed the action succeeded.", "tool-failure-result", tool=tool, args=args, result=result))
    return examples


def handoff_examples() -> list[dict[str, Any]]:
    tasks = [
        "rewrite the authentication module",
        "fix the TypeScript build",
        "edit every CSS file",
        "run a terminal command",
        "install project dependencies",
        "review the application architecture",
        "patch a Rust backend command",
        "delete generated project files",
        "optimize the database layer",
        "change Windows system settings",
        "debug a failing test suite",
        "refactor the model orchestrator",
        "write a new Tauri command",
        "audit the project for security bugs",
        "modify package.json and rebuild",
    ]
    prompts = ["Please {task}.", "Can you {task} right now?", "I need Nebula to {task}."]
    answers = [
        "I haven't performed that action. Nebula should hand this request to the coding workflow so it can inspect the project, use the required tools, and verify the result.",
        "I cannot complete that safely in quick chat. Nebula should route it to the coding or review workflow with the relevant project context.",
        "I have not changed anything. This needs Nebula's coding workflow and verified tool results before completion can be reported.",
    ]
    return [make_example(template.format(task=task), answers[index], "handoff") for task in tasks for index, template in enumerate(prompts)]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=project_root() / "training/data/synthetic-gemma-v1.jsonl")
    args = parser.parse_args()
    examples = [
        *identity_examples(),
        *chat_examples(),
        *memory_examples(),
        *time_and_system_examples(),
        *file_examples(),
        *web_examples(),
        *failure_examples(),
        *handoff_examples(),
    ]
    fingerprints: set[str] = set()
    unique: list[dict[str, Any]] = []
    for example in examples:
        fingerprint = json.dumps(example["messages"], ensure_ascii=False, sort_keys=True)
        if fingerprint not in fingerprints:
            fingerprints.add(fingerprint)
            unique.append(example)
    if len(unique) < 300:
        raise SystemExit(f"Synthetic set is too small: {len(unique)} examples")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("\n".join(json.dumps(item, ensure_ascii=False) for item in unique) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(args.output), "examples": len(unique)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
