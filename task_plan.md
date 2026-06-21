# 📋 task_plan.md — Testurai Build Plan
> B.L.A.S.T. Framework | V1.0 | Started: 2026-04-04 | Last Updated: 2026-06-21

---

## ✅ Phase 0: Initialization (COMPLETE)
- [x] Read B.L.A.S.T. framework
- [x] Reviewed all 5 UI screens (Dashboard, Generate, Loading, History, Settings, View Test Plan)
- [x] Conducted 5 Discovery Questions
- [x] Extracted Test Plan template structure (13 sections)
- [x] Installed Python 3.12
- [x] Created `gemini.md` (Project Constitution)
- [x] Created `task_plan.md` (this file)
- [x] Created `findings.md`
- [x] Created `progress.md`

---

## 🏗️ Phase 1: B — Blueprint (COMPLETE)
- [x] North Star defined
- [x] Integrations scoped (Jira V1, all 3 LLMs configurable)
- [x] Source of truth decided (local file-based)
- [x] Delivery payload defined (DOCX + PDF export)
- [x] Behavioral rules locked (strict template adherence)
- [x] Data schema defined in `gemini.md`

---

## ⚡ Phase 2: L — Link (Connectivity) — COMPLETE
- [x] Create `.env` template
- [x] Build `tools/jira_client.py` — Jira REST API connection
- [x] Build `tools/llm_client.py` — OpenAI / Anthropic / Google / Groq / Local LLM
- [x] Verify all connections respond correctly
- [x] Write architecture SOPs for each integration

---

## ⚙️ Phase 3: A — Architect (3-Layer Build) — COMPLETE

### Layer 1: Architecture SOPs
- [x] `architecture/jira_integration_sop.md`
- [x] `architecture/llm_generation_sop.md`
- [x] `architecture/export_sop.md`
- [x] `architecture/storage_sop.md`

### Layer 2: Navigation (Flask API — `api/index.py`)
- [x] `GET  /api/stats` — Dashboard stats
- [x] `GET  /api/jira/issue/<id>` — Fetch & preview Jira issue
- [x] `POST /api/generate` — Generate test plan
- [x] `GET  /api/history` — List all test plans
- [x] `GET  /api/history/<id>` — Get single test plan
- [x] `DELETE /api/history/<id>` — Delete plan (admin)
- [x] `GET  /api/export/<id>/<format>` — Export DOCX/PDF
- [x] `POST /api/export-scripts` — Export Playwright scripts as ZIP
- [x] `GET  /api/settings` — Get masked settings
- [x] `PUT  /api/settings` — Save settings (admin)
- [x] `PATCH /api/settings/active-provider` — Switch active LLM
- [x] `POST /api/settings/test-connection` — Test LLM/Jira connection
- [x] `GET  /api/test-cases` — All test cases across plans
- [x] `POST /api/generate-script/:planId/:tcId` — Generate Playwright script
- [x] `POST /api/auth/login` — JWT login
- [x] `GET  /api/auth/me` — Current user
- [x] `GET/POST/PUT/DELETE /api/users` — User management (admin)

### Layer 3: Tools
- [x] `tools/jira_client.py` — fetch_issue()
- [x] `tools/llm_client.py` — generate(), supports 5 providers
- [x] `tools/test_plan_generator.py` — orchestrates fetch → prompt → parse
- [x] `tools/export_engine.py` — to_docx(), to_pdf()
- [x] `tools/storage_manager.py` — Supabase + local JSON fallback

---

## ✨ Phase 4: S — Stylize (Frontend) — COMPLETE

### Pages
- [x] **Login** — Email/password auth, JWT, redirect guard
- [x] **Dashboard** — Stats cards, recent plans table, quick generate panel, activity feed
- [x] **Generate Page** — Jira fetch, issue preview, LLM config, generation overlay with progress steps
- [x] **History Page** — Search, filter tabs, starred, table, export CSV
- [x] **View Test Plan Page** — Full plan render, export DOCX/PDF, share, regenerate
- [x] **Test Cases Dashboard** — View/edit/create/delete test cases across all plans
- [x] **Test Scripts (TestGenerator)** — Convert test cases to Playwright TypeScript scripts
- [x] **Settings Page** — LLM provider cards, API key config, test connection, Jira integration
- [x] **User Management** — Admin: create/edit/delete users, role assignment

### CSS Design System
- [x] Dark theme (#0D1117 base, #161B22 cards)
- [x] Cyan accent (#00E5CC / #00C9B1)
- [x] Glassmorphism cards, smooth hover animations
- [x] Responsive layout
- [x] Confirmation dialog for destructive actions

### Additional Features (post-blueprint)
- [x] Multi-LLM provider selector in sidebar (developer+ role)
- [x] Role-Based Access Control (normal / developer / admin)
- [x] Supabase Auth (JWT) + user profiles
- [x] Playwright script generation per test case
- [x] Overwrite confirmation dialog (test plan + script)
- [x] Semantic HTML & accessibility (aria-label, aria-current, aria-hidden)
- [x] Route-level code splitting + vendor chunk caching (Vite)

---

## 🛰️ Phase 5: T — Trigger (Deployment) — COMPLETE
- [x] `requirements.txt` with all Python dependencies
- [x] `README.md` — Full setup, API reference, deployment guide
- [x] Deployed to Vercel — `https://testurai.vercel.app`
- [x] SEO: OG tags, Twitter Card, canonical URL, sitemap.xml, robots.txt, PWA manifest
- [x] End-to-end tested with real Jira issues

---

## 🔄 Post-Launch Updates

| Date | Update |
|------|--------|
| 2026-06-21 | Rebranded from TestMaster → Testurai; updated all source files, domain, and Vercel project |

---

## 📊 Overall Progress

| Phase | Status |
|-------|--------|
| 0 — Initialization | ✅ Complete |
| 1 — Blueprint | ✅ Complete |
| 2 — Link | ✅ Complete |
| 3 — Architect | ✅ Complete |
| 4 — Stylize | ✅ Complete |
| 5 — Trigger | ✅ Complete |
