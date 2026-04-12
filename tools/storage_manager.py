"""
storage_manager.py — Layer 3 Tool
Manages all local file persistence: history.json, settings.json.
SOP: architecture/storage_sop.md
"""
import json
import os
from datetime import datetime
from pathlib import Path
try:
    from supabase import create_client, Client
except ImportError:
    Client = None

BASE_DIR = Path(__file__).parent.parent
DATA_DIR = BASE_DIR / "data"
HISTORY_FILE = DATA_DIR / "history.json"
SETTINGS_FILE = DATA_DIR / "settings.json"
EXPORTS_DIR = DATA_DIR / "exports"

# Ensure directories exist locally (fails gracefully on cloud Read-Only filesystems like Vercel)
try:
    DATA_DIR.mkdir(exist_ok=True)
    EXPORTS_DIR.mkdir(exist_ok=True)
except OSError:
    pass

def get_supabase():
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    if url and key and Client:
        return create_client(url, key)
    return None

# ─── Default structures ───────────────────────────────────────────────────────

DEFAULT_SETTINGS = {
    "jira": {
        "base_url": "",
        "email": "",
        "api_token": ""
    },
    "llm": {
        "active_provider": "openai",
        "providers": {
            "openai": {
                "api_key": "",
                "model": "gpt-4o",
                "temperature": 0.7,
                "max_tokens": 4096
            },
            "anthropic": {
                "api_key": "",
                "model": "claude-3-5-sonnet-20241022",
                "temperature": 0.7,
                "max_tokens": 4096
            },
            "google": {
                "api_key": "",
                "model": "gemini-1.5-pro",
                "temperature": 0.7,
                "max_tokens": 4096
            },
            "groq": {
                "api_key": "",
                "model": "llama-3.3-70b-versatile",
                "temperature": 0.7,
                "max_tokens": 4096
            },
            "local_llm": {
                "api_key": "not-needed",
                "base_url": "http://localhost:11434/v1",
                "model": "llama3",
                "temperature": 0.7,
                "max_tokens": 4096
            }
        }
    }
}


# ─── Settings ────────────────────────────────────────────────────────────────

def load_settings() -> dict:
    """Load settings from Supabase (if available), then local JSON, with env overrides."""
    merged = DEFAULT_SETTINGS.copy()
    
    # 0. Initialize sources for diagnostics
    for provider in merged["llm"]["providers"]:
        merged["llm"]["providers"][provider]["_source"] = "DEFAULT"
    merged["jira"]["_source"] = "DEFAULT"

    # 1. Try Supabase
    sb = get_supabase()
    if sb:
        try:
            res = sb.table("settings").select("config").eq("id", "global").execute()
            if res.data and res.data[0].get("config"):
                _deep_merge(merged, res.data[0]["config"])
                # Mark as DB source if the key exists and is non-empty
                db_config = res.data[0]["config"]
                for p, cfg in db_config.get("llm", {}).get("providers", {}).items():
                    if cfg.get("api_key") and p in merged["llm"]["providers"]:
                        merged["llm"]["providers"][p]["_source"] = "SUPABASE_DB"
                if db_config.get("jira", {}).get("api_token"):
                    merged["jira"]["_source"] = "SUPABASE_DB"
        except Exception as e:
            print(f"Supabase settings load error: {e}")

    # 2. Try Local (Fallback/Dev)
    try:
        if SETTINGS_FILE.exists():
            with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                stored = json.load(f)
                if stored:
                    _deep_merge(merged, stored)
                    # Note: we don't distinguish from DB for now as Vercel uses DB
    except Exception as e:
        # Expected on some cloud environments where Path.exists() is unreliable but file is missing
        print(f"Local settings load bypassed: {e}")

    # 3. Vercel env overrides (Highest Priority)
    def env_ovr(provider_key, env_key):
        val = os.getenv(env_key)
        if val:
            # Strip whitespace to prevent invisible character errors
            clean_val = str(val).strip()
            merged["llm"]["providers"][provider_key]["api_key"] = clean_val
            merged["llm"]["providers"][provider_key]["_source"] = f"VERCEL_ENV ({len(clean_val)} chars)"

    env_ovr("openai", "OPENAI_API_KEY")
    env_ovr("anthropic", "ANTHROPIC_API_KEY")
    env_ovr("google", "GEMINI_API_KEY")
    env_ovr("groq", "GROQ_API_KEY")
    
    jira_token = os.getenv("JIRA_API_TOKEN")
    if jira_token:
        clean_jira = str(jira_token).strip()
        merged["jira"]["api_token"] = clean_jira
        merged["jira"]["_source"] = f"VERCEL_ENV ({len(clean_jira)} chars)"
        
    if os.getenv("JIRA_EMAIL"): merged["jira"]["email"] = str(os.getenv("JIRA_EMAIL")).strip()
    if os.getenv("JIRA_BASE_URL"): merged["jira"]["base_url"] = str(os.getenv("JIRA_BASE_URL")).strip()
    
    return merged


def _load_stored_settings() -> dict:
    """
    Load only the persisted layer (Supabase DB or local JSON) WITHOUT env var overrides.
    Used by save_settings so user-entered keys are not clobbered by env vars.
    """
    base = json.loads(json.dumps(DEFAULT_SETTINGS))  # deep copy

    # 1. Try Supabase
    sb = get_supabase()
    if sb:
        try:
            res = sb.table("settings").select("config").eq("id", "global").execute()
            if res.data and res.data[0].get("config"):
                _deep_merge(base, res.data[0]["config"])
                return base
        except Exception as e:
            print(f"Supabase stored-settings load error: {e}")

    # 2. Try local JSON
    try:
        if SETTINGS_FILE.exists():
            with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                stored = json.load(f)
                if stored:
                    _deep_merge(base, stored)
    except Exception as e:
        print(f"Local stored-settings load error: {e}")

    return base


def save_settings(new_settings: dict) -> None:
    """
    Persist settings to Supabase and attempt local save.
    Merges against the raw STORED layer only (not env var overrides),
    so user-entered keys are never clobbered by Vercel environment variables.
    """
    # 1. Read only the stored (DB/local) layer — no env var overrides
    stored = _load_stored_settings()

    # 2. Smart merge: skip any masked (••) values coming from the UI
    _smart_merge(stored, new_settings)
    final_settings = stored

    # 3. Strip internal _source keys before persisting
    _strip_source_keys(final_settings)

    # 4. Log debug info
    print("--- [DEBUG: STORAGE SAVE] ---")
    for p, cfg in final_settings.get("llm", {}).get("providers", {}).items():
        key = cfg.get("api_key", "")
        if key and not key.startswith("•"):
            print(f"[{p}] Key length: {len(key)} | Prefix: {key[:3]}...")

    # 5. Supabase (Primary for Cloud)
    sb = get_supabase()
    if sb:
        try:
            sb.table("settings").upsert({"id": "global", "config": final_settings}).execute()
            print("[save_settings] Saved to Supabase OK")
        except Exception as e:
            print(f"Supabase settings save error: {e}")

    # 6. Local (Primary for Dev, fails gracefully on Vercel read-only FS)
    try:
        SETTINGS_FILE.parent.mkdir(exist_ok=True)
        with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
            json.dump(final_settings, f, indent=2)
        print("[save_settings] Saved to local JSON OK")
    except Exception:
        pass


def _strip_source_keys(d: dict) -> None:
    """Recursively remove _source diagnostic keys before persisting."""
    for k in list(d.keys()):
        if k == "_source":
            del d[k]
        elif isinstance(d[k], dict):
            _strip_source_keys(d[k])


def get_persistence_mode() -> dict:
    """
    Returns what storage backend is active, so the UI can warn users
    when no durable storage is available on Vercel.
    """
    sb = get_supabase()
    if sb:
        try:
            sb.table("settings").select("id").limit(1).execute()
            return {"mode": "supabase", "durable": True}
        except Exception:
            return {"mode": "supabase_error", "durable": False}

    local_exists = SETTINGS_FILE.exists() if not os.getenv("VERCEL") else False
    if local_exists:
        return {"mode": "local", "durable": True}

    # Running on Vercel without Supabase — ephemeral only
    return {"mode": "ephemeral", "durable": False,
            "warning": "No durable storage. Configure SUPABASE_URL + SUPABASE_KEY in Vercel env vars, or set API keys directly as Vercel environment variables (OPENAI_API_KEY, ANTHROPIC_API_KEY, etc)."}


def _smart_merge(base: dict, override: dict) -> None:
    """
    Recursively merge override into base, but SKIP any string values 
    that start with '•' (masked keys).
    """
    for k, v in override.items():
        # Strip all strings coming from UI to prevent accidental white space
        if isinstance(v, str):
            v = v.strip()
            override[k] = v  # IMPORTANT: Update the source dictionary too!

        if isinstance(v, str) and (v.startswith("•") or v.startswith("...•")):
            # It's a masked key from the UI, IGNORE IT (keep the base value)
            continue
        
        if k in base and isinstance(base[k], dict) and isinstance(v, dict):
            _smart_merge(base[k], v)
        else:
            base[k] = v


def get_settings_masked() -> dict:
    """Return settings with API keys masked (last 4 chars visible)."""
    settings = load_settings()
    masked = json.loads(json.dumps(settings))  # deep copy

    # Mask Jira token
    tok = masked.get("jira", {}).get("api_token", "")
    masked["jira"]["api_token"] = _mask_key(tok)

    # Mask LLM keys
    for provider in masked.get("llm", {}).get("providers", {}).values():
        provider["api_key"] = _mask_key(provider.get("api_key", ""))

    return masked


def _mask_key(key: str | None) -> str:
    if not key or not isinstance(key, str) or len(key) <= 4:
        return "••••"
    return "••••••••••••" + key[-4:]


def _deep_merge(base: dict, override: dict) -> None:
    for k, v in override.items():
        if k in base and isinstance(base[k], dict) and isinstance(v, dict):
            _deep_merge(base[k], v)
        else:
            base[k] = v


# ─── History ─────────────────────────────────────────────────────────────────

def load_history() -> list:
    """Load all test plan records from Supabase (if configured) or local JSON."""
    sb = get_supabase()
    if sb:
        try:
            res = sb.table("test_plans").select("*").execute()
            records = res.data or []
            return sorted(records, key=lambda r: r.get("generated_at", ""), reverse=True)
        except Exception as e:
            print(f"Supabase read error: {e}")
            
    try:
        if HISTORY_FILE.exists():
            with open(HISTORY_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception as e:
        print(f"Local history load error (ignored on Vercel): {e}")
    return []


def save_test_plan(record: dict) -> None:
    """Append a test plan record to Supabase and/or history.json."""
    sb = get_supabase()
    if sb:
        try:
            sb.table("test_plans").upsert(record).execute()
        except Exception as e:
            print(f"Supabase upsert error: {e}")

    history = load_history()
    # Update if same ID exists, otherwise append
    existing_ids = [r["id"] for r in history]
    if record["id"] in existing_ids:
        history = [record if r["id"] == record["id"] else r for r in history]
    else:
        history.append(record)
    try:
        with open(HISTORY_FILE, "w", encoding="utf-8") as f:
            json.dump(history, f, indent=2, ensure_ascii=False)
    except Exception:
        pass


def get_test_plan(plan_id: str) -> dict | None:
    """Find and return a single test plan by ID."""
    history = load_history()
    for record in history:
        if record["id"] == plan_id:
            return record
    return None


def delete_test_plan(plan_id: str) -> bool:
    """Remove a test plan by ID. Returns True if deleted."""
    sb = get_supabase()
    if sb:
        try:
            sb.table("test_plans").delete().eq("id", plan_id).execute()
        except Exception as e:
            print(f"Supabase delete error: {e}")

    history = load_history()
    new_history = [r for r in history if r["id"] != plan_id]
    if len(new_history) == len(history):
        return False
    try:
        with open(HISTORY_FILE, "w", encoding="utf-8") as f:
            json.dump(new_history, f, indent=2, ensure_ascii=False)
    except Exception:
        pass
    return True


def next_id() -> str:
    """Generate the next unique test plan ID: TP-YYYYMMDD-NNN."""
    today = datetime.now().strftime("%Y%m%d")
    history = load_history()
    today_records = [r for r in history if r.get("id", "").startswith(f"TP-{today}-")]
    seq = len(today_records) + 1
    return f"TP-{today}-{seq:03d}"


def get_stats() -> dict:
    """Compute dashboard statistics from history."""
    history = load_history()
    completed = [r for r in history if r.get("status") == "completed"]
    settings = load_settings()

    total_time = sum(r.get("generation_time_seconds", 0) for r in completed)
    avg_time = round(total_time / len(completed), 1) if completed else 0.0

    # Count unique Jira IDs
    jira_ids = set(r.get("jira_id", "") for r in history)

    active_provider = settings.get("llm", {}).get("active_provider", "openai")
    active_model = (
        settings.get("llm", {})
        .get("providers", {})
        .get(active_provider, {})
        .get("model", "GPT-4o")
    )

    return {
        "total_plans": len(history),
        "jira_issues_processed": len(jira_ids),
        "avg_generation_time": avg_time,
        "active_model": active_model,
        "active_provider": active_provider,
        "recent": history[-10:][::-1],  # last 10, newest first
    }
