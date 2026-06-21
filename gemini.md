# 📜 gemini.md — Testurai Project Constitution
> **This file is LAW. All schemas, rules, and architecture decisions live here.**
> Last Updated: 2026-04-04 (Rev 2 — Tech stack finalized)

---

## 🎯 Project Identity

- **Project Name:** Testurai
- **Version:** V1.0
- **Mission:** Accept a Jira Issue ID → fetch feature details via Jira REST API → generate a structured Test Plan using an LLM → export as `.docx` or `.pdf` — all within a local web app.

## 🛠️ Tech Stack (Locked)

| Layer | Technology |
|-------|------------|
| Frontend | **React + Vite** (React Router, Axios) |
| Backend | **Flask** (Python 3.12) |
| LLM Output Format | **Structured Markdown** — 13 sections matching template headers |
| DOCX Export | **python-docx** — maps markdown sections to template styles |
| PDF Export | **reportlab** — pure Python, no system dependencies |
| Storage | Supabase (PostgreSQL) for Vercel hosting, Local fallback for dev |
| LLM Providers | OpenAI (GPT-4o), Anthropic (Claude), Google (Gemini) — all configurable |

---

## 🗂️ Data Schemas

### Schema 1: User Settings (persisted in `data/settings.json`)
```json
{
  "jira": {
    "base_url": "https://yourcompany.atlassian.net",
    "email": "user@company.com",
    "api_token": "ATATT..."
  },
  "llm": {
    "active_provider": "openai",
    "providers": {
      "openai": {
        "api_key": "sk-...",
        "model": "gpt-4o",
        "temperature": 0.7,
        "max_tokens": 4096
      },
      "anthropic": {
        "api_key": "sk-ant-...",
        "model": "claude-3-5-sonnet-20241022",
        "temperature": 0.7,
        "max_tokens": 4096
      },
      "google": {
        "api_key": "AIza...",
        "model": "gemini-1.5-pro",
        "temperature": 0.7,
        "max_tokens": 4096
      }
    }
  }
}
```

### Schema 2: Jira Issue Payload (fetched, stored in `.tmp/`)
```json
{
  "id": "PROJ-1042",
  "title": "Implement user authentication flow",
  "description": "Full issue description from Jira",
  "priority": "High",
  "assignee": "John Doe",
  "reporter": "Jane Smith",
  "status": "In Progress",
  "issue_type": "Story",
  "labels": ["Frontend", "Integration"],
  "story_points": 8,
  "acceptance_criteria": "...",
  "sub_tasks": [
    { "id": "PROJ-1043", "title": "Create login form UI" }
  ],
  "created_at": "2026-03-01T10:00:00Z",
  "updated_at": "2026-04-01T12:00:00Z"
}
```

### Schema 3: Generation Request (frontend → backend)
```json
{
  "jira_issue_id": "PROJ-1042",
  "llm_provider": "openai",
  "include_sub_tasks": true,
  "include_negative_cases": true,
  "detail_level": "standard",
  "test_plan_format": ["unit", "integration", "e2e", "security"]
}
```

### Schema 4: Test Plan Record (persisted in `data/history.json`)
```json
{
  "id": "TP-20260404-001",
  "jira_id": "PROJ-1042",
  "title": "Test Plan for PROJ-1042: Implement user authentication flow",
  "jira_title": "Implement user authentication flow",
  "llm_provider": "openai",
  "llm_model": "gpt-4o",
  "status": "completed",
  "generated_at": "2026-04-04T13:30:00+05:30",
  "test_case_count": 12,
  "content": {
    "objective": "...",
    "scope": {
      "inclusions": ["Login", "Dashboard Page", "Create Account"],
      "exclusion": ["Support Page"]
    },
    "test_environments": ["Windows 10 - Chrome, Firefox, Edge"],
    "defect_reporting_procedure": "...",
    "test_strategy": "...",
    "test_schedule": "2 Sprints",
    "test_deliverables": ["Test Plan", "Test Scenarios", "Test Cases", "Reports"],
    "entry_exit_criteria": {
      "requirement_analysis": { "entry": "...", "exit": "..." },
      "test_execution": { "entry": "...", "exit": "..." },
      "test_closure": { "entry": "...", "exit": "..." }
    },
    "tools": ["JIRA Bug Tracking Tool", "Mind map Tool"],
    "risks_and_mitigations": [
      { "risk": "Non-Availability of a Resource", "mitigation": "Backup Resource Planning" }
    ],
    "approvals": ["Test Plan", "Test Scenarios", "Test Cases", "Reports"],
    "test_cases": [
      {
        "id": "TC-001",
        "title": "Verify successful user login with valid credentials",
        "priority": "High",
        "type": "positive",
        "preconditions": ["Navigate to login page"],
        "steps": ["Enter valid username and password", "Click Login button"],
        "expected_result": "User is redirected to dashboard",
        "test_data": { "username": "testuser", "password": "P@ssw0rd!" }
      }
    ]
  },
  "export_paths": {
    "docx": "data/exports/PROJ-1042_20260404.docx",
    "pdf": "data/exports/PROJ-1042_20260404.pdf"
  }
}
```

---

## 📋 Template Sections (STRICT — No additions allowed)

The output MUST exactly follow this structure from `Template/Test Plan - Template.docx`:

1. **Objective** — Purpose, goals, scope overview
2. **Scope**
   - **Inclusions** — Features/pages to be tested
   - **Exclusion** — Features/pages NOT in scope
   - **Test Environments** — OS, browsers, devices, network
   - **Defect Reporting Procedure** — Steps, tools (JIRA), POC table
   - **Test Strategy** — Step 1 (test cases), Step 2 (smoke→regression), Step 3 (best practices)
   - **Test Schedule** — Sprint-based timeline table
   - **Test Deliverables** — List of artefacts
   - **Entry and Exit Criteria**
     - Requirement Analysis (Entry/Exit)
     - Test Execution (Entry/Exit)
     - Test Closure (Entry/Exit)
   - **Tools** — JIRA, Mind Map, Snipping, Word/Excel
   - **Risks and Mitigations** — Risk/Mitigation table
   - **Approvals** — Document approval list

---

## 🏗️ Architecture Invariants

1. **Template Supremacy:** The LLM MUST generate content strictly within the 13 template sections above. No new sections.
2. **No Key Exposure:** API keys are NEVER rendered in the UI. They are stored in `data/settings.json` (masked) and `.env`.
3. **Deterministic Storage:** Every generated test plan gets a unique ID: `TP-YYYYMMDD-NNN`.
4. **Export Fidelity:** DOCX output must use `python-docx` and mirror the original template styles (headings, normal paragraphs, tables). PDF output uses `reportlab`.
4a. **Markdown Contract:** The LLM MUST output structured Markdown with exact section headers matching the 13 template sections. The backend parser splits on these headers to populate `history.json`.
5. **Vercel Enabled:** Vercel serverless integration using `supabase` as cloud storage for Test Plans instead of local files. API keys are strictly configured via Vercel Environment Variables.
6. **Negative Cases:** When `include_negative_cases = true`, each test scenario must include at least one negative/edge test case.
7. **Self-Annealing:** On any tool error, log to `progress.md` and retry once before surfacing the error to the UI.

---

## 📂 File Structure

```
Test_Plan_Generator/
├── gemini.md                  # Project Constitution (this file)
├── .env                       # API keys backup (git-ignored)
├── architecture/              # Layer 1: SOPs
│   ├── jira_integration_sop.md
│   ├── llm_generation_sop.md
│   ├── export_sop.md
│   └── storage_sop.md
├── tools/                     # Layer 3: Python scripts
│   ├── jira_client.py
│   ├── llm_client.py
│   ├── test_plan_generator.py
│   ├── export_engine.py
│   └── storage_manager.py
├── frontend/                  # HTML/CSS/JS web app
│   ├── index.html
│   ├── css/
│   └── js/
├── server.py                  # Flask API server (Layer 2: Navigation)
├── data/                      # Persistent local storage
│   ├── settings.json
│   ├── history.json
│   └── exports/
├── Template/                  # Original .docx template
├── .tmp/                      # Ephemeral workbench
└── requirements.txt
```

---

## 🔄 Maintenance Log

| Date | Change | Author |
|------|--------|--------|
| 2026-04-04 | Initial Project Constitution created | System Pilot |
| 2026-04-04 | Tech stack finalized: React+Vite frontend, reportlab PDF, Markdown LLM output | System Pilot |
