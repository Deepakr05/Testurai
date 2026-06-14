# TestMaster

AI-powered test plan generator that turns Jira issues into structured test plans and Playwright scripts.

**Live:** https://test-master-ai.vercel.app

---

## Features

- **Test Plan Generation** — Fetch any Jira issue and generate unit, integration, e2e, and security test cases using an LLM of your choice
- **Test Script Generation** — Convert individual test cases into ready-to-run Playwright TypeScript scripts
- **Test Case Dashboard** — View, edit, create, and delete test cases across all plans
- **History** — Browse, search, filter, and star past test plans
- **Export** — Download plans as DOCX or PDF; export all scripts as a ZIP
- **Multi-LLM** — Supports OpenAI, Anthropic, Google Gemini, Groq, and local LLMs (Ollama)
- **User Auth & RBAC** — Supabase-backed login with three role levels
- **Durable Storage** — Supabase PostgreSQL in production; local JSON fallback for dev

---

## Role-Based Access Control

| Role | Access |
|------|--------|
| `normal` | Read-only — view plans, history, test cases, export |
| `developer` | Read/write — generate plans & scripts, edit test cases, manage settings |
| `admin` | Full access — everything above + delete plans, manage users |

Admins are the only ones who can create or delete user accounts. There is no public sign-up.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite 8, React Router 7, Axios |
| Backend | Flask 3.1 (Python), served via Vercel serverless |
| Auth | Supabase Auth (JWT) |
| Database | Supabase (PostgreSQL via PostgREST) |
| LLM | OpenAI / Anthropic / Google / Groq / Local |
| Export | python-docx, ReportLab |

---

## Project Structure

```
├── api/
│   └── index.py          # Flask API (all endpoints)
├── src/
│   ├── context/
│   │   ├── AuthContext.jsx       # JWT auth state + axios header injection
│   │   └── ProviderContext.jsx   # Global LLM provider selector
│   ├── components/
│   │   ├── Sidebar.jsx           # Nav, LLM picker, user info, logout
│   │   └── ProtectedRoute.jsx    # Auth + role guard
│   └── pages/
│       ├── Login.jsx             # Email/password login
│       ├── Dashboard.jsx
│       ├── Generate.jsx          # Jira → Test Plan
│       ├── TestCaseDashboard.jsx
│       ├── TestGenerator.jsx     # Playwright script generator
│       ├── History.jsx
│       ├── ViewPlan.jsx
│       ├── Settings.jsx
│       └── UserManagement.jsx    # Admin: create/edit/delete users
├── tools/
│   ├── storage_manager.py  # Supabase + local JSON persistence
│   ├── jira_client.py
│   ├── llm_client.py
│   ├── test_plan_generator.py
│   └── export_engine.py
├── vercel.json
├── requirements.txt
└── .env.example
```

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/Deepakr05/Test_master.git
cd Test_master
npm install
pip install -r requirements.txt
```

### 2. Supabase — create tables

Run this SQL in your Supabase project (SQL Editor):

```sql
-- Settings table
CREATE TABLE IF NOT EXISTS public.settings (
    id     TEXT PRIMARY KEY,
    config JSONB
);
ALTER TABLE public.settings DISABLE ROW LEVEL SECURITY;

-- Test plans table
CREATE TABLE IF NOT EXISTS public.test_plans (
    id              TEXT PRIMARY KEY,
    jira_id         TEXT,
    jira_title      TEXT,
    title           TEXT,
    status          TEXT,
    llm_provider    TEXT,
    llm_model       TEXT,
    generated_at    TIMESTAMPTZ,
    test_case_count INT,
    generation_time_seconds FLOAT,
    starred         BOOLEAN DEFAULT FALSE,
    content         JSONB
);
ALTER TABLE public.test_plans DISABLE ROW LEVEL SECURITY;

-- User profiles table (linked to Supabase Auth)
CREATE TABLE IF NOT EXISTS public.user_profiles (
    id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email      TEXT NOT NULL,
    role       TEXT NOT NULL DEFAULT 'normal' CHECK (role IN ('normal','developer','admin')),
    full_name  TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.user_profiles DISABLE ROW LEVEL SECURITY;

-- Auto-create profile when a new auth user is created
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.user_profiles(id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name',''));
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

### 3. Create your admin user

1. Go to **Supabase → Authentication → Users → Add User** and create your account
2. Run this SQL to grant admin access (replace the email):

```sql
UPDATE public.user_profiles SET role = 'admin' WHERE email = 'your@email.com';
```

### 4. Environment variables

Copy `.env.example` to `.env` and fill in your values:

```env
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_KEY=eyJ...          # Anon/public JWT key (from Project Settings → API)
SUPABASE_SERVICE_KEY=eyJ...  # Service role key (required for admin user creation)

JIRA_BASE_URL=https://yourcompany.atlassian.net
JIRA_EMAIL=you@company.com
JIRA_API_TOKEN=ATATT...

# LLM keys — at least one required
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=AIza...
GROQ_API_KEY=gsk_...
```

### 5. Run locally

```bash
# Terminal 1 — Flask API on :5000
python api/index.py

# Terminal 2 — Vite frontend on :3000 (proxies /api to :5000)
npm run dev
```

Open http://localhost:3000 and sign in with your Supabase user credentials.

---

## Deploying to Vercel

The project is pre-configured for Vercel via `vercel.json`. Push to `main` to auto-deploy.

**Required Vercel environment variables:**

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_KEY` | Supabase anon/public JWT key |
| `SUPABASE_SERVICE_KEY` | Supabase service role key (admin ops) |
| `OPENAI_API_KEY` / `GROQ_API_KEY` / etc. | At least one LLM key |
| `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` | Optional — Jira integration |

---

## API Reference

### Auth
| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/login` | public | Sign in, returns JWT + user |
| GET | `/api/auth/me` | normal | Current user info |

### Users (admin only)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/users` | List all users |
| POST | `/api/users` | Create user (requires `SUPABASE_SERVICE_KEY`) |
| PUT | `/api/users/:id` | Update role / name |
| DELETE | `/api/users/:id` | Delete user |

### Core
| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| GET | `/api/stats` | normal | Dashboard stats |
| GET | `/api/jira/issue/:id` | developer | Fetch Jira issue |
| POST | `/api/generate` | developer | Generate test plan |
| GET | `/api/history` | normal | List plans |
| GET | `/api/history/:id` | normal | Plan detail |
| DELETE | `/api/history/:id` | admin | Delete plan |
| GET | `/api/test-cases` | normal | All test cases |
| POST | `/api/generate-script/:planId/:tcId` | developer | Generate Playwright script |
| GET | `/api/export/:id/:fmt` | normal | Export as docx/pdf |
| POST | `/api/export-scripts` | developer | Export scripts as ZIP |

### Settings
| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| GET | `/api/settings` | normal | Masked settings |
| PUT | `/api/settings` | admin | Save settings |
| GET | `/api/settings/providers` | normal | LLM provider list |
| PATCH | `/api/settings/active-provider` | developer | Switch active LLM |
| POST | `/api/settings/test-connection` | developer | Test LLM/Jira connection |
