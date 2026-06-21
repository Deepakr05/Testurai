"""
test_plan_generator.py — Layer 3 Tool
Orchestrates: Jira fetch → LLM prompt → Markdown parse → Save to history.
SOP: architecture/llm_generation_sop.md
"""
import time
import re
from datetime import datetime, timezone
from pathlib import Path

from tools.jira_client import fetch_issue
from tools.llm_client import generate
from tools.storage_manager import load_settings, save_test_plan, next_id

# ─── System Prompt (Template Contract) ───────────────────────────────────────

SYSTEM_PROMPT = """You are Testurai, an expert QA engineer and test planner.

Your task is to generate a comprehensive test plan in STRICT structured Markdown format.

## Output Rules (MANDATORY):
1. You MUST produce EXACTLY the following sections in EXACTLY this order, using EXACTLY these headers.
2. Do NOT add, remove, or rename any section.
3. Fill each section with detailed, professional QA content relevant to the Jira issue provided.
4. If a toggle for negative cases is enabled, include at least one negative/edge test case per scenario.
5. Do NOT invent or assume any names, team members, on-call (OC) contacts, point-of-contact (POC) persons, department names, or role holders. Use the placeholder "TBD" for any person or team that is not explicitly provided in the Jira issue.
6. Do NOT add "OC", "On-Call", or any operational abbreviations unless explicitly stated in the Jira issue description.

## Required Markdown Structure:

# Test Plan: {JIRA_ID} — {TITLE}

## Objective
[2-3 sentences describing purpose and goals of this test plan]

## Scope

### Inclusions
[Bullet list of features/pages/flows that WILL be tested]

### Exclusion
[Bullet list of features/pages NOT in scope]

### Test Environments
[Table with columns: Environment | URL/Details]
[List of OS, browser, device combinations to test on]

### Defect Reporting Procedure
[Steps for defect identification, reporting, triage]
[Table with columns: Defect Area | POC]
[Tools: JIRA]

### Test Strategy
**Step 1:** [Test case creation approach, design techniques used]
**Step 2:** [Smoke → regression testing procedure]
**Step 3:** [Best practices: context-driven, shift-left, exploratory]

### Test Schedule
[Table with columns: Task | Duration]

### Test Deliverables
[Bullet list of artefacts: Test Plan, Test Scenarios, Test Cases, Reports]

### Entry and Exit Criteria

#### Requirement Analysis
**Entry Criteria:** [conditions to start requirement analysis]
**Exit Criteria:** [conditions to complete requirement analysis]

#### Test Execution
**Entry Criteria:** [conditions to start test execution]
**Exit Criteria:** [conditions to complete test execution]

#### Test Closure
**Entry Criteria:** [conditions to start test closure]
**Exit Criteria:** [conditions to complete test closure]

### Tools
[Bullet list: JIRA Bug Tracking Tool, Mind map Tool, Snipping Screenshot Tool, Word and Excel documents]

### Risks and Mitigations
[Table with columns: Risk | Mitigation]

### Approvals
[Bullet list of documents requiring client approval]

## Test Cases

### TC-001: [Test case title]
**Priority:** High | Medium | Low
**Type:** Positive | Negative | Edge Case
**Preconditions:**
- [precondition 1]
**Steps:**
1. [step 1]
2. [step 2]
**Expected Result:** [expected outcome]
**Test Data:**
- key: value

[Continue for all test cases, numbering sequentially TC-001, TC-002, etc.]
"""


# ─── Prompt Builder ───────────────────────────────────────────────────────────

def build_prompt(jira_issue: dict, options: dict) -> str:
    include_negative = options.get("include_negative_cases", True)
    include_sub = options.get("include_sub_tasks", True)
    detail_level = options.get("detail_level", "standard")
    formats = options.get("test_plan_format", ["unit", "integration", "e2e"])

    sub_task_text = ""
    if include_sub and jira_issue.get("sub_tasks"):
        sub_task_text = "\n\n**Sub-Tasks:**\n" + "\n".join(
            f"- {st['id']}: {st['title']}" for st in jira_issue["sub_tasks"]
        )

    format_text = ", ".join(f for f in formats if f)

    neg_instruction = (
        "Include at least ONE negative/edge test case per scenario."
        if include_negative
        else "Focus on positive/happy-path test cases only."
    )

    detail_instruction = (
        "Be thorough and comprehensive — include edge cases and boundary conditions."
        if detail_level == "detailed"
        else "Use standard depth — cover main flows and critical paths."
    )

    return f"""Generate a complete test plan for the following Jira issue.

## Jira Issue Details

**Issue ID:** {jira_issue["id"]}
**Title:** {jira_issue["title"]}
**Type:** {jira_issue["issue_type"]}
**Priority:** {jira_issue["priority"]}
**Status:** {jira_issue["status"]}
**Assignee:** {jira_issue["assignee"]}
**Reporter:** {jira_issue["reporter"]}
**Story Points:** {jira_issue.get("story_points", "N/A")}
**Labels:** {", ".join(jira_issue.get("labels", [])) or "None"}

**Description:**
{jira_issue["description"] or "No description provided."}

**Acceptance Criteria:**
{jira_issue.get("acceptance_criteria") or "Not specified — infer from description."}
{sub_task_text}

## Generation Options
- **Test Types Required:** {format_text}
- **Negative Cases:** {neg_instruction}
- **Detail Level:** {detail_instruction}

Now generate the complete test plan following the EXACT markdown structure from the system prompt.
Replace {{JIRA_ID}} with '{jira_issue["id"]}' and {{TITLE}} with '{jira_issue["title"]}' in the heading.
"""


# ─── Markdown Parser ──────────────────────────────────────────────────────────

def parse_test_cases(markdown: str) -> list:
    """Extract structured test cases from the ## Test Cases section of markdown."""
    test_cases = []
    tc_section_match = re.search(r"## Test Cases\s*(.*?)(?:\Z)", markdown, re.DOTALL)
    if not tc_section_match:
        return test_cases

    tc_text = tc_section_match.group(1)
    tc_blocks = re.split(r"(?=### TC-\d+:)", tc_text)

    for block in tc_blocks:
        block = block.strip()
        if not block.startswith("### TC-"):
            continue

        # Parse fields
        title_match = re.match(r"### (TC-\d+): (.+)", block)
        if not title_match:
            continue

        tc_id = title_match.group(1)
        title = title_match.group(2).strip()

        priority = _extract_field(block, "Priority") or "Medium"
        tc_type = _extract_field(block, "Type") or "Positive"
        expected = _extract_field(block, "Expected Result") or ""

        preconditions = _extract_list(block, "Preconditions")
        steps = _extract_numbered_list(block, "Steps")
        test_data = _extract_test_data(block)

        test_cases.append({
            "id": tc_id,
            "title": title,
            "priority": priority,
            "type": tc_type,
            "preconditions": preconditions,
            "steps": steps,
            "expected_result": expected,
            "test_data": test_data,
        })

    return test_cases


def _extract_field(text: str, field_name: str) -> str:
    pattern = rf"\*\*{field_name}:\*\*\s*(.+?)(?:\n|$)"
    match = re.search(pattern, text)
    return match.group(1).strip() if match else ""


def _extract_list(text: str, section_name: str) -> list:
    pattern = rf"\*\*{section_name}:\*\*\s*\n((?:\s*[-*]\s*.+\n?)*)"
    match = re.search(pattern, text)
    if not match:
        return []
    lines = match.group(1).strip().split("\n")
    return [re.sub(r"^\s*[-*]\s*", "", l).strip() for l in lines if l.strip()]


def _extract_numbered_list(text: str, section_name: str) -> list:
    pattern = rf"\*\*{section_name}:\*\*\s*\n((?:\s*\d+\.\s*.+\n?)*)"
    match = re.search(pattern, text)
    if not match:
        return []
    lines = match.group(1).strip().split("\n")
    return [re.sub(r"^\s*\d+\.\s*", "", l).strip() for l in lines if l.strip()]


def _extract_test_data(text: str) -> dict:
    pattern = r"\*\*Test Data:\*\*\s*\n((?:\s*-\s*.+\n?)*)"
    match = re.search(pattern, text)
    if not match:
        return {}
    result = {}
    for line in match.group(1).strip().split("\n"):
        line = re.sub(r"^\s*-\s*", "", line).strip()
        if ":" in line:
            k, _, v = line.partition(":")
            result[k.strip()] = v.strip()
    return result


# ─── Main Orchestrator ────────────────────────────────────────────────────────

def generate_test_plan(request: dict, save: bool = True) -> dict:
    """
    Full pipeline: fetch Jira → build prompt → call LLM → parse → save.
    Returns the saved test plan record.
    """
    settings = load_settings()
    jira_issue_id = request["jira_issue_id"]
    provider = request.get("llm_provider") or settings["llm"]["active_provider"]

    # Step 1: Fetch Jira issue
    jira_issue = fetch_issue(jira_issue_id, settings)

    # Step 2: Build prompt
    prompt = build_prompt(jira_issue, request)

    # Step 3: Call LLM (with one retry on failure)
    start_time = time.time()
    markdown_content = None
    last_error = None

    for attempt in range(2):
        try:
            system_prompt_override = settings.get("templates", {}).get("test_plan_prompt", "").strip()
            markdown_content = generate(
                prompt=prompt,
                system_prompt=system_prompt_override or SYSTEM_PROMPT,
                provider=provider,
                settings=settings,
            )
            break
        except Exception as e:
            last_error = e
            if attempt == 0:
                time.sleep(2)  # Self-annealing: wait 2s and retry once

    if markdown_content is None:
        raise RuntimeError(f"LLM generation failed after 2 attempts: {last_error}")

    elapsed = round(time.time() - start_time, 1)

    # Step 4: Parse test cases from markdown
    test_cases = parse_test_cases(markdown_content)

    # Step 5: Get the active model name
    provider_cfg = settings.get("llm", {}).get("providers", {}).get(provider, {})
    model_name = provider_cfg.get("model", provider)

    # Step 6: Build record (Schema 4)
    plan_id = next_id()
    record = {
        "id": plan_id,
        "jira_id": jira_issue["id"],
        "title": f"Test Plan for {jira_issue['id']}: {jira_issue['title']}",
        "jira_title": jira_issue["title"],
        "llm_provider": provider,
        "llm_model": model_name,
        "status": "completed",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "generation_time_seconds": elapsed,
        "test_case_count": len(test_cases),
        "jira_issue": jira_issue,
        "content": {
            "markdown": markdown_content,
            "test_cases": test_cases,
        },
        "export_paths": {
            "docx": None,
            "pdf": None,
        },
    }

    # Step 7: Persist (skipped if save=False — caller handles persistence)
    if save:
        save_test_plan(record)

    return record
