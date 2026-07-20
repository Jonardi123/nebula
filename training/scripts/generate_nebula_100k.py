#!/usr/bin/env python3
"""Generate Nebula's deterministic 100K unified-assistant training corpus.

The individual rows are composed from reviewed response patterns. They are not
claimed to be individually human-reviewed. Split-specific vocabulary and family
IDs keep train, validation, and hidden evaluation scenarios isolated.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path
from typing import Any, Callable


SYSTEM = """You are Nebula, one local AI assistant running on Jonard's computer.
Be calm, capable, concise, honest, and practical. Your identity is Nebula regardless of the underlying model.
Help with conversation, programming, project work, memory, web research, authorized defensive security, and careful reverse engineering of user-owned or explicitly authorized artifacts.
Read before editing, preserve unrelated work, and prefer root-cause fixes. Never claim an action succeeded unless a tool result confirms it.
When a tool is required, output exactly one valid JSON object as {\"tool\":\"tool_name\",\"args\":{}} with no Markdown or surrounding prose. Use only registered tools and never invent tool results.
Separate observations from inferences. Ask for missing scope when authorization or important context is unclear.
Refuse credential theft, persistence, evasion, exfiltration, destructive payloads, security disabling, attacks on third parties, or hidden execution. Offer safe defensive analysis, hardening, recovery, or an isolated lab alternative.
For risky, large, security-sensitive, performance, or architectural work, perform careful analysis and request a review pass."""


CATEGORY_TOTALS = {
    "reverse_engineering": 32_000,
    "tool_agent_workflows": 15_000,
    "coding_debugging": 13_000,
    "defensive_cybersecurity": 9_000,
    "failure_honesty": 7_000,
    "review_architecture": 6_000,
    "general_chat": 5_000,
    "memory_context": 4_000,
    "web_research": 3_000,
    "identity_voice_mobile": 3_000,
    "planning_routing": 3_000,
}

SPLIT_RATIOS = {"train": 90, "validation": 5, "hidden": 5}
ALLOWED_TOOLS = {
    "get_current_time", "get_system_info", "list_files", "read_file",
    "search_memory", "web_fetch", "web_search", "run_command",
}

VOCAB = {
    "train": {
        "apps": ["desktop shell", "project indexer", "local bridge", "chat runtime", "plugin host", "memory service", "task runner", "voice overlay"],
        "files": ["src/App.tsx", "src/lib/agent.ts", "src/lib/tools.ts", "package.json", "README.md", "src-tauri/src/lib.rs", "src/lib/memory.ts", "src/lib/lmstudio.ts"],
        "artifacts": ["telemetry-helper.exe", "renderer.dll", "sync-agent.bin", "plugin-host.exe", "archive-reader.dll", "device-bridge.exe", "update-worker.bin", "codec-module.dll"],
        "symbols": ["parseHeader", "dispatchTask", "decodeFrame", "validatePacket", "loadProfile", "resolveTarget", "mapSection", "handleMessage"],
        "projects": ["Nebula", "Atlas", "Orion", "Pulse", "Helix", "Lumen", "Vector", "Aster"],
    },
    "validation": {
        "apps": ["diagnostic console", "workspace daemon", "model dashboard", "automation service", "source viewer", "command palette"],
        "files": ["src/lib/contextEngine.ts", "src/lib/modelManager.ts", "src/components/TerminalPanel.tsx", "vite.config.ts", "tauri.conf.json", "SECURITY.md"],
        "artifacts": ["preview-engine.exe", "migration-tool.dll", "sensor-relay.bin", "layout-worker.exe", "cache-parser.dll", "session-agent.bin"],
        "symbols": ["scanManifest", "routeIntent", "unpackRecord", "verifyState", "collectMetrics", "applyDelta"],
        "projects": ["Solstice", "Beacon", "Nova", "Quartz", "Nimbus", "Kepler"],
    },
    "hidden": {
        "apps": ["recovery monitor", "extension broker", "research console", "notification worker", "snapshot service", "audit viewer"],
        "files": ["src/lib/runReplay.ts", "src/lib/notifications.ts", "src/components/Diagnostics.tsx", "tsconfig.json", "Cargo.toml", "CONTRIBUTING.md"],
        "artifacts": ["event-decoder.exe", "compat-layer.dll", "trace-reader.bin", "policy-host.exe", "bundle-indexer.dll", "restore-agent.bin"],
        "symbols": ["mergeTimeline", "inspectEnvelope", "readDirectory", "classifyEvent", "restoreSession", "checkBoundary"],
        "projects": ["Umbra", "Meridian", "Comet", "Vega", "Argon", "Zenith"],
    },
}


def choose(values: list[str], index: int, stride: int = 1, offset: int = 0) -> str:
    return values[(index * stride + offset) % len(values)]


def scenario_context(split: str, index: int) -> str:
    """Return a natural, unique context without leaking synthetic row IDs."""
    v = VOCAB[split]
    phases = ["startup", "migration", "recovery", "release review", "daily use", "test run", "offline mode", "shutdown"]
    constraints = ["minimal patch", "read-only pass", "no unrelated edits", "local-only data", "cancel-safe flow", "bounded output", "documented evidence", "rollback available"]
    surfaces = ["Windows desktop", "iPhone companion", "local API", "project workspace", "diagnostics view", "voice session", "background task", "test environment"]
    dimensions = [v["projects"], v["apps"], v["files"], phases, constraints, surfaces]
    selected: list[str] = []
    cursor = index
    for values in dimensions:
        selected.append(values[cursor % len(values)])
        cursor //= len(values)
    project, app, file_path, phase, constraint, surface = selected
    return f"Context: {project}, {app}, `{file_path}`, {phase}, {constraint}, {surface}."


def tool(name: str, args: dict[str, Any]) -> str:
    return json.dumps({"tool": name, "args": args}, separators=(",", ":"), sort_keys=True)


def row(prompt: str, answer: str, category: str, split: str, index: int, *,
        extra: list[dict[str, str]] | None = None, tags: list[str] | None = None) -> dict[str, Any]:
    messages = [{"role": "system", "content": SYSTEM}]
    if extra:
        messages.extend(extra)
    messages.extend([{"role": "user", "content": prompt}, {"role": "assistant", "content": answer}])
    family_seed = f"{split}:{category}:{index // 5}"
    return {
        "messages": messages,
        "metadata": {
            "source": "deterministic_reviewed_template_v1",
            "reviewStatus": "template_reviewed",
            "category": category,
            "split": split,
            "familyId": hashlib.sha256(family_seed.encode()).hexdigest()[:20],
            "templateVersion": 1,
            "tags": tags or [],
        },
    }


def reverse_engineering(split: str, i: int) -> tuple[str, str, list[str]]:
    v = VOCAB[split]
    artifact = choose(v["artifacts"], i, 3)
    symbol = choose(v["symbols"], i, 5, 1)
    formats = ["PE64", "ELF64", "Mach-O", ".NET assembly", "WASM module", "Android DEX", "firmware image", "minidump"]
    evidence = ["imports", "section layout", "embedded strings", "cross-references", "call graph", "resource table", "exception records", "version metadata"]
    goals = [
        "identify its likely purpose", "reconstruct the data flow", "compare it with the previous release",
        "explain a crash path", "document an undocumented file format", "locate a parser boundary",
        "triage suspicious behavior defensively", "map a protocol state machine",
    ]
    constraints = [
        "Do not execute it", "Use static evidence first", "Keep observations separate from inferences",
        "Assume the artifact is user-owned", "Stop if authorization becomes unclear",
    ]
    fmt = choose(formats, i, 7)
    observed = choose(evidence, i, 11, 2)
    goal = choose(goals, i, 13, 3)
    constraint = choose(constraints, i, 17)
    prompts = [
        f"I own `{artifact}`, a {fmt} artifact. Plan an authorized analysis to {goal} around `{symbol}` using its {observed}. {constraint}.",
        f"For a permitted local investigation of `{artifact}`, how should I {goal} near `{symbol}`? The available evidence is {observed}; format is {fmt}. {constraint}.",
        f"Document a safe reverse-engineering workflow for `{artifact}` ({fmt}) focused on `{symbol}` and {observed}, so I can {goal}. {constraint}.",
        f"Review this authorized reverse-engineering objective: {goal} in `{artifact}` by examining {observed} around `{symbol}`. It is {fmt}. {constraint}.",
        f"Without running `{artifact}`, describe how to {goal} from its {observed}, especially `{symbol}`. Treat it as an authorized {fmt} sample.",
    ]
    prompt = prompts[i % len(prompts)]
    if "crash" in goal or fmt == "minidump":
        answer = f"Start by preserving the original and recording its hash. Confirm the {fmt} metadata, map the faulting thread and stack, then correlate `{symbol}` with loaded modules, exception records, and nearby control flow. Report confirmed offsets and symbols separately from hypotheses; do not claim a root cause until the evidence converges."
    elif "file format" in goal or "protocol" in goal:
        answer = f"Hash and preserve the artifact, then inventory the {observed}. Trace reads and bounds checks around `{symbol}`, record field offsets, lengths, endianness, and state transitions, and test hypotheses only with inert fixtures in an isolated lab. Mark every inferred field as provisional until multiple samples confirm it."
    elif "suspicious" in goal:
        answer = f"Do not execute it on the normal PC. Record provenance and hashes, inspect the {fmt} headers, {observed}, imports, signatures, and cross-references around `{symbol}` in an isolated defensive workflow. Treat indicators as evidence to correlate, not proof, and escalate rather than developing evasion or payload behavior."
    else:
        answer = f"Preserve and hash the original first. Validate the {fmt} structure, inventory the {observed}, then trace callers and callees of `{symbol}` while naming inputs, outputs, side effects, and uncertainty. Compare findings against trusted metadata or a prior build and keep confirmed observations distinct from inferred behavior."
    return prompt, answer, ["authorized", "static-analysis", fmt.lower().replace(" ", "-")]


def tool_agent_workflows(split: str, i: int) -> tuple[str, str, list[str]]:
    v = VOCAB[split]
    file_path = choose(v["files"], i, 5)
    directory = file_path.rsplit("/", 1)[0] if "/" in file_path else "."
    query = f"{choose(v['projects'], i, 3)} {choose(['coding style', 'last build failure', 'routing decision', 'user preference', 'security lesson', 'project summary'], i, 7)}"
    searches = ["current stable release notes", "official API documentation", "latest security advisory", "current compatibility requirements"]
    url_hosts = ["https://docs.python.org/3/", "https://doc.rust-lang.org/book/", "https://www.typescriptlang.org/docs/", "https://tauri.app/learn/"]
    commands = ["git status", "npm test", "npm run build", "cargo check", "npm run lint", "git diff --stat"]
    modes = i % 8
    if modes == 0:
        prompt, answer = f"Read `{file_path}` before making any recommendation. Output only the tool request.", tool("read_file", {"path": file_path})
    elif modes == 1:
        prompt, answer = f"List `{directory}` before selecting files. Output only registered tool JSON.", tool("list_files", {"path": directory})
    elif modes == 2:
        prompt, answer = f"Search Nebula memory for `{query}` before answering. Output only the tool call.", tool("search_memory", {"query": query})
    elif modes == 3:
        q = choose(searches, i, 5) + " for " + choose(v["apps"], i, 3)
        prompt, answer = f"Find current public information about {q}. Output only the web-search tool call.", tool("web_search", {"query": q, "maxResults": 5})
    elif modes == 4:
        url = choose(url_hosts, i, 3)
        prompt, answer = f"Fetch the public documentation page `{url}`. Output only registered tool JSON.", tool("web_fetch", {"url": url})
    elif modes == 5:
        command = choose(commands, i, 5)
        prompt, answer = f"Run the safe project check `{command}` in the active workspace. Output only the command tool request.", tool("run_command", {"command": command})
    elif modes == 6:
        prompt, answer = "Get the current local time using the registered tool. Output only JSON.", tool("get_current_time", {})
    else:
        prompt, answer = "Request local system information using the registered tool. Output only JSON.", tool("get_system_info", {})
    ordered_tools = sorted(ALLOWED_TOOLS)
    return prompt, answer, ["tool-json", ordered_tools[i % len(ordered_tools)]]


def coding_debugging(split: str, i: int) -> tuple[str, str, list[str]]:
    v = VOCAB[split]
    app = choose(v["apps"], i, 3)
    file_path = choose(v["files"], i, 5)
    problems = [
        ("uses `value || fallback` even though zero is valid", "Replace logical OR with nullish coalescing so only null or undefined selects the fallback."),
        ("ignores `response.ok` before parsing JSON", "Check `response.ok`, throw a useful error for non-success status codes, and parse only successful responses."),
        ("starts an interval without clearing it", "Retain the interval ID and clear it in the lifecycle cleanup."),
        ("mutates a React state array before setting it", "Create a new array, preferably with a functional state update, so React observes a new reference."),
        ("maps an async callback but never awaits the promises", "Collect the promises and await `Promise.all`, or iterate sequentially when ordering or rate limits matter."),
        ("trusts parsed local storage without validation", "Handle missing and malformed JSON, validate the shape, and fall back to known-safe defaults."),
        ("concatenates user input into a shell command", "Avoid a shell string; validate the input and pass it as structured arguments to a fixed executable."),
        ("updates state after an aborted request", "Check the abort signal before committing state and ignore results belonging to stale request IDs."),
        ("uses an unstable array index as a React key", "Use a stable item identifier so reordering does not attach state to the wrong element."),
        ("assumes an indexed array element always exists", "Widen the return type or guard the indexed value before using it."),
        ("adds an event listener without removing it", "Remove the same event type and handler reference in cleanup."),
        ("reports success inside a catch block", "Return an accurate failure, preserve a sanitized error, and never claim success after an exception."),
    ]
    problem, fix = problems[i % len(problems)]
    prompts = [
        f"In `{file_path}`, the {app} {problem}. Give the smallest maintainable fix and one verification step.",
        f"Debug this issue in the {app}: it {problem}. The relevant file is `{file_path}`. Keep the patch scoped.",
        f"A review found that `{file_path}` {problem}. Explain the root cause, minimal correction, and test.",
        f"Propose a narrow fix for `{file_path}` in the {app}; it {problem}. Do not refactor unrelated code.",
    ]
    answer = f"Root cause: the current behavior is unsafe or incorrect because it {problem}. Minimal fix: {fix} Verify the original failing case plus the normal path, and keep unrelated formatting or refactors out of the patch."
    return prompts[i % len(prompts)], answer, ["coding", "minimal-patch"]


def defensive_cybersecurity(split: str, i: int) -> tuple[str, str, list[str]]:
    v = VOCAB[split]
    app = choose(v["apps"], i, 3)
    findings = [
        ("builds a SQL query with string interpolation", "Critical", "Use a parameterized query and validate the expected input shape."),
        ("assigns untrusted text to innerHTML", "High", "Render plain text or sanitize required markup with a maintained sanitizer."),
        ("logs authorization headers", "High", "Redact secrets before persistence and rotate any exposed credential."),
        ("accepts client-provided roles for authorization", "Critical", "Resolve identity server-side and enforce permissions on every protected operation."),
        ("processes webhooks without signature verification", "High", "Verify the signature over the raw body and reject stale or replayed events."),
        ("reflects arbitrary CORS origins with credentials", "Critical", "Use a narrow origin allowlist and reject unknown origins."),
        ("stores passwords in plaintext", "Critical", "Store salted password hashes using a password-specific algorithm and verify them safely."),
        ("joins untrusted path traversal segments", "High", "Resolve against an allowed root and reject any path that escapes it."),
        ("uses reusable password-reset tokens", "High", "Make reset tokens random, short-lived, single-use, and invalidated after use."),
        ("disables TLS certificate validation", "Critical", "Repair the certificate chain or trust configuration instead of disabling verification."),
    ]
    issue, severity, remediation = findings[i % len(findings)]
    prompt = f"Authorized defensive review of the {app}: it {issue}. Give one concise finding with severity and remediation for {choose(v['projects'], i, 5)}."
    answer = f"{severity}: the {app} {issue}, which creates a security boundary failure. {remediation} Add a regression test for the rejected malicious or invalid input and confirm normal behavior still works."
    return prompt, answer, ["defensive", "secure-review", severity.lower()]


def failure_honesty(split: str, i: int) -> tuple[str, str, list[str]]:
    v = VOCAB[split]
    outcomes = [
        ("Exit code 1; TypeScript error in {file}", "The check failed with a TypeScript error in `{file}`; it did not pass."),
        ("The process timed out after 90 seconds", "The operation is incomplete because it timed out after 90 seconds; no success should be reported."),
        ("Permission denied while reading {file}", "The read did not succeed because access to `{file}` was denied."),
        ("LM Studio returned model unloaded", "The model request did not run because the selected model is unloaded."),
        ("Tool returned file not found for {file}", "The tool could not find `{file}`; its contents were not inspected."),
        ("Command cancelled by the user", "The command was cancelled, so later output must be ignored and no completion claimed."),
        ("HTTP 503 from the model server", "The model server is temporarily unavailable; the request was not completed."),
        ("JSON parsing failed for stored settings", "Stored settings could not be parsed; use validated defaults and preserve a recoverable diagnostic."),
    ]
    result, answer = outcomes[i % len(outcomes)]
    file_path = choose(v["files"], i, 5)
    result = result.format(file=file_path)
    answer = answer.format(file=file_path)
    extra = [
        {"role": "user", "content": f"Run the requested check for {choose(v['projects'], i, 3)}."},
        {"role": "assistant", "content": tool("run_command", {"command": "npm test"})},
        {"role": "tool", "content": result},
    ]
    return "What actually happened? Do not overstate the result.", answer, ["honesty", "tool-result", json.dumps(extra)]


def review_architecture(split: str, i: int) -> tuple[str, str, list[str]]:
    v = VOCAB[split]
    app = choose(v["apps"], i, 5)
    patterns = [
        ("duplicates model-routing rules across UI components", "High", "centralize routing behind one typed orchestrator interface and test route decisions"),
        ("lets two writers update the same conversation record", "High", "establish one transactional writer and stream changes through a versioned repository"),
        ("loads every secondary panel during startup", "Medium", "lazy-load secondary surfaces and gate only data that the first screen needs"),
        ("retries tool execution after transport failure", "Critical", "retry inference transport only; never repeat side effects without a new idempotency decision"),
        ("stores provider tokens in a general settings document", "High", "move credentials to the OS credential vault and redact diagnostics"),
        ("has no stale-run identifier for async results", "High", "attach a run ID and abort signal, then discard results from superseded runs"),
        ("renders an unbounded message history", "Medium", "load recent messages first and page older history on demand"),
        ("mixes filesystem policy with React presentation state", "Medium", "keep policy and execution behind backend interfaces with structured errors"),
    ]
    issue, severity, fix = patterns[i % len(patterns)]
    prompt = f"Review the architecture of the {app} in {choose(v['projects'], i, 3)}. It {issue}. Return severity, impact, and a scoped recommendation."
    answer = f"{severity}: the {app} {issue}. This increases regression, race, or security risk across shared workflows. Recommendation: {fix}. Add focused contract tests before moving callers, and avoid rewriting unrelated modules."
    return prompt, answer, ["review", "architecture", severity.lower()]


def general_chat(split: str, i: int) -> tuple[str, str, list[str]]:
    project = choose(VOCAB[split]["projects"], i, 3)
    topics = ["a difficult debugging session", "learning Rust", "planning tomorrow's work", "a slow local model", "organizing project notes", "finishing a long build"]
    tones = ["brief", "calm", "encouraging", "direct", "practical"]
    topic = choose(topics, i, 5)
    tone = choose(tones, i, 7)
    prompt = f"Give me a {tone} two-sentence response about {topic} while I work on {project}."
    answer = f"Take the next concrete step on {project} and verify it before expanding the scope. You do not need to solve {topic} all at once; make the next result observable and build from there."
    return prompt, answer, ["chat", "concise"]


def memory_context(split: str, i: int) -> tuple[str, str, list[str]]:
    v = VOCAB[split]
    project = choose(v["projects"], i, 3)
    facts = ["preferred formatting style", "last successful build command", "active model choice", "recent UI decision", "known startup fix", "project package manager"]
    fact = choose(facts, i, 5)
    if i % 2 == 0:
        prompt = f"Before advising on {project}, search memory for its {fact}. Output only the tool call."
        answer = tool("search_memory", {"query": f"{project} {fact}"})
    else:
        prompt = f"Memory contains no confirmed {fact} for {project}. What should Nebula say?"
        answer = f"I don't have a confirmed {fact} for {project}. I can inspect the current project or ask you before making an assumption."
    return prompt, answer, ["memory", "context"]


def web_research(split: str, i: int) -> tuple[str, str, list[str]]:
    v = VOCAB[split]
    topics = ["current framework support", "latest stable release", "recent security guidance", "current API behavior", "updated platform requirements", "official migration documentation"]
    topic = f"{choose(topics, i, 5)} for {choose(v['apps'], i, 3)}"
    if i % 3 == 0:
        prompt = f"This may have changed. Search the public web for {topic}; output only tool JSON."
        answer = tool("web_search", {"query": topic, "maxResults": 5})
    elif i % 3 == 1:
        prompt = f"You have not checked a current source for {topic}. Can you state it as fact?"
        answer = "No. That information may have changed, so I should verify it with a current authoritative source and cite the checked page and date."
    else:
        prompt = f"A web snippet claims {topic}. How should Nebula handle it?"
        answer = "Treat the snippet as a lead, open the authoritative source, verify the claim and publication context, cite the URL, and record the date checked before saving a durable finding."
    return prompt, answer, ["web", "verification"]


def identity_voice_mobile(split: str, i: int) -> tuple[str, str, list[str]]:
    v = VOCAB[split]
    prompts_answers = [
        ("Who are you? Answer in one short sentence.", "I'm Nebula, your local AI assistant."),
        ("Are you Qwen or another vendor model?", "I'm Nebula; underlying local models are implementation details available in diagnostics."),
        ("Give a voice-friendly confirmation that you heard my request.", "I heard you. I'll keep the response clear and concise."),
        ("The phone bridge is offline. Did my request reach the PC?", "I can't confirm that it reached the PC while the bridge is offline; reconnect before sending it again."),
        ("Voice recognition returned no speech. What should the UI say?", "I didn't hear any speech. Try again or use text input."),
        ("The mobile app is paired but the PC is asleep. Can you run a task?", "No. The PC must be awake with Nebula running before I can process the task."),
    ]
    prompt, answer = prompts_answers[i % len(prompts_answers)]
    prompt = f"For {choose(v['projects'], i, 5)}: {prompt}"
    return prompt, answer, ["identity", "voice", "mobile"]


def planning_routing(split: str, i: int) -> tuple[str, str, list[str]]:
    v = VOCAB[split]
    tasks = [
        ("rename one variable", "coding", "inspect the relevant file, make the minimal change, and run a focused check"),
        ("review an authentication redesign", "review", "map trust boundaries, inspect the proposed change, and report severity-ranked findings"),
        ("answer a simple everyday question", "chat", "answer directly without loading project context or a heavy review route"),
        ("research a recently changed API", "research", "check memory, search authoritative current sources, fetch the best pages, and cite them"),
        ("diagnose a failing build", "coding", "inspect project metadata, reproduce the safe check, locate the first actionable error, and propose a scoped fix"),
        ("change a shared architecture", "coding-plus-review", "map dependencies, plan a staged patch, test it, then request an independent review"),
    ]
    task, route, plan = tasks[i % len(tasks)]
    prompt = f"Route and plan this request for {choose(v['projects'], i, 3)}: {task}. Keep it concise and do not expose internal model names."
    answer = f"Use the {route} capability: {plan}. Keep the same Nebula conversation context throughout and report only observed results."
    return prompt, answer, ["planning", "routing", route]


GENERATORS: dict[str, Callable[[str, int], tuple[str, str, list[str]]]] = {
    "reverse_engineering": reverse_engineering,
    "tool_agent_workflows": tool_agent_workflows,
    "coding_debugging": coding_debugging,
    "defensive_cybersecurity": defensive_cybersecurity,
    "failure_honesty": failure_honesty,
    "review_architecture": review_architecture,
    "general_chat": general_chat,
    "memory_context": memory_context,
    "web_research": web_research,
    "identity_voice_mobile": identity_voice_mobile,
    "planning_routing": planning_routing,
}


def split_count(total: int, split: str) -> int:
    return total * SPLIT_RATIOS[split] // 100


def generate(output_dir: Path, category_totals: dict[str, int] | None = None) -> dict[str, Any]:
    requested_totals = category_totals or CATEGORY_TOTALS
    output_dir.mkdir(parents=True, exist_ok=True)
    counts: dict[str, Counter[str]] = {name: Counter() for name in SPLIT_RATIOS}
    fingerprints: set[str] = set()
    prompts: set[str] = set()
    families: dict[str, set[str]] = {name: set() for name in SPLIT_RATIOS}
    files = {name: (output_dir / f"{name}.jsonl").open("w", encoding="utf-8", newline="\n") for name in SPLIT_RATIOS}
    try:
        for split in SPLIT_RATIOS:
            global_index = 0
            for category, total in requested_totals.items():
                count = split_count(total, split)
                generator = GENERATORS[category]
                for index in range(count):
                    prompt, answer, tags = generator(split, index)
                    prompt = f"{prompt} {scenario_context(split, index)}"
                    extra = None
                    if category == "failure_honesty":
                        encoded = tags.pop()
                        extra = json.loads(encoded)
                    item = row(prompt, answer, category, split, index, extra=extra, tags=tags)
                    serialized_messages = json.dumps(item["messages"], ensure_ascii=False, sort_keys=True)
                    fingerprint = hashlib.sha256(serialized_messages.encode()).hexdigest()
                    normalized_prompt = " ".join(prompt.casefold().split())
                    if fingerprint in fingerprints or normalized_prompt in prompts:
                        raise RuntimeError(f"duplicate generated content in {split}/{category} at {index}")
                    fingerprints.add(fingerprint)
                    prompts.add(normalized_prompt)
                    families[split].add(item["metadata"]["familyId"])
                    files[split].write(json.dumps(item, ensure_ascii=False, separators=(",", ":")) + "\n")
                    counts[split][category] += 1
                    global_index += 1
    finally:
        for handle in files.values():
            handle.close()

    family_overlap = sum(len(families[a] & families[b]) for a, b in (("train", "validation"), ("train", "hidden"), ("validation", "hidden")))
    manifest = {
        "name": "Nebula Unified 100K v1",
        "version": 1,
        "systemPromptSha256": hashlib.sha256(SYSTEM.encode()).hexdigest(),
        "total": sum(sum(counter.values()) for counter in counts.values()),
        "splitRatios": SPLIT_RATIOS,
        "categoryTotals": requested_totals,
        "splits": {name: {"total": sum(counter.values()), "categories": dict(counter)} for name, counter in counts.items()},
        "familyOverlap": family_overlap,
        "uniqueMessageFingerprints": len(fingerprints),
        "uniqueUserPrompts": len(prompts),
        "claim": "Rows are deterministic compositions of reviewed templates; they are not individually human-reviewed.",
    }
    (output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, default=Path("training/nebula-100k"))
    args = parser.parse_args()
    manifest = generate(args.output_dir)
    print(json.dumps(manifest, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
