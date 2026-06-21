import os
import re
import sys
import json
import functools
import traceback
import urllib.request
import urllib.error
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS

app = Flask(__name__)

# CORS allowlist — defaults cover local dev + the production Vercel host.
_DEFAULT_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "https://testurai.vercel.app",
]
_env_origins = os.getenv("FRONTEND_ORIGIN", "").strip()
_allowed_origins = (
    [o.strip() for o in _env_origins.split(",") if o.strip()]
    if _env_origins else _DEFAULT_ORIGINS
)
CORS(app, resources={r"/api/*": {"origins": _allowed_origins}})

DEFAULT_PLAYWRIGHT_PROMPT = (
    "You are an expert QA engineer writing robust Playwright TypeScript tests. "
    "ONLY return valid TypeScript code. Do not wrap code in markdown fences if possible."
)

# Path-parameter validators.
_JIRA_ID_RE  = re.compile(r"^[A-Z][A-Z0-9_]{1,19}-\d{1,9}$")
_PLAN_ID_RE  = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
_TC_ID_RE    = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
_USER_ID_RE  = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)

def _valid_jira_id(v): return bool(v) and bool(_JIRA_ID_RE.match(v.strip().upper()))
def _valid_plan_id(v): return bool(v) and bool(_PLAN_ID_RE.match(v))
def _valid_tc_id(v):   return bool(v) and bool(_TC_ID_RE.match(v))
def _valid_user_id(v): return bool(v) and bool(_USER_ID_RE.match(v.strip()))

# ── Auth ─────────────────────────────────────────────────────────────────────
# Set AUTH_DISABLED=true in .env to bypass auth during local development
# without a Supabase instance.
_AUTH_DISABLED = os.getenv("AUTH_DISABLED", "").lower() in ("1", "true", "yes")

_ROLE_LEVELS = {"normal": 0, "developer": 1, "admin": 2}


def _supabase_url() -> str:
    return os.getenv("SUPABASE_URL", "").rstrip("/")


def _supabase_key() -> str:
    return os.getenv("SUPABASE_KEY", "")


def _rpc(function_name: str, params: dict) -> list:
    """Call a Supabase SECURITY DEFINER RPC via PostgREST. Returns list of rows."""
    url = _supabase_url()
    key = _supabase_key()
    if not url or not key:
        return []
    try:
        payload = json.dumps(params).encode()
        req = urllib.request.Request(
            f"{url}/rest/v1/rpc/{function_name}",
            data=payload,
            headers={
                "Content-Type": "application/json",
                "apikey": key,
                "Authorization": f"Bearer {key}",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            return json.loads(resp.read().decode()) or []
    except Exception as e:
        print(f"[auth] RPC {function_name} error: {e}", file=sys.stderr)
        return []


def _fetch_profile(user_id: str) -> dict | None:
    rows = _rpc("get_user_profile", {"p_user_id": user_id})
    return rows[0] if rows else None


def _verify_token(token: str):
    """
    Verify a Supabase JWT against the Auth REST API, then fetch the user's
    role profile via RPC. Returns (user_dict, profile_dict) or (None, None).
    """
    url = _supabase_url()
    key = _supabase_key()
    if not url or not key:
        return None, None
    try:
        # 1. Validate JWT via Supabase Auth
        req = urllib.request.Request(
            f"{url}/auth/v1/user",
            headers={"Authorization": f"Bearer {token}", "apikey": key},
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            user_data = json.loads(resp.read().decode())
        user_id = user_data.get("id")
        if not user_id:
            return None, None

        # 2. Fetch role via SECURITY DEFINER RPC (bypasses anon PostgREST restrictions)
        profile = _fetch_profile(user_id)
        if not profile:
            return None, None
        return user_data, profile

    except urllib.error.HTTPError as e:
        if e.code == 401:
            return None, None
        print(f"[auth] Token verify HTTP {e.code}", file=sys.stderr)
        return None, None
    except Exception as e:
        print(f"[auth] Token verify error: {e}", file=sys.stderr)
        return None, None


def require_auth(min_role: str = "normal"):
    """Decorator: verify Supabase JWT and enforce minimum role."""
    def decorator(f):
        @functools.wraps(f)
        def decorated(*args, **kwargs):
            if _AUTH_DISABLED:
                request.auth_user = {"id": "dev", "email": "dev@local"}
                request.auth_profile = {"role": "admin", "email": "dev@local"}
                return f(*args, **kwargs)
            auth_header = request.headers.get("Authorization", "")
            if not auth_header.startswith("Bearer "):
                return err("Authentication required", 401)
            token = auth_header[7:]
            user, profile = _verify_token(token)
            if not user or not profile:
                return err("Invalid or expired session", 401)
            role = profile.get("role", "normal")
            if (_ROLE_LEVELS.get(role, -1) < _ROLE_LEVELS.get(min_role, 999)):
                return err("Insufficient permissions", 403)
            request.auth_user = user
            request.auth_profile = profile
            return f(*args, **kwargs)
        return decorated
    return decorator


def _admin_rest(method: str, path: str, body: dict | None = None):
    """Call Supabase Auth Admin REST API using the service role key."""
    url = _supabase_url()
    svc_key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not url or not svc_key:
        return None, "SUPABASE_SERVICE_KEY not configured"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        f"{url}/auth/v1/admin/{path}",
        data=data,
        headers={
            "Content-Type": "application/json",
            "apikey": svc_key,
            "Authorization": f"Bearer {svc_key}",
        },
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = resp.read().decode().strip()
            return json.loads(body) if body else {}, None
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read().decode()).get("msg", str(e))
        except Exception:
            msg = str(e)
        return None, msg
    except Exception as e:
        return None, str(e)


# ── Bootstrap ────────────────────────────────────────────────────────────────
BOOTSTRAP_ERROR = None
try:
    from pathlib import Path
    from datetime import datetime
    from dotenv import load_dotenv

    env_path = Path(__file__).parent.parent / ".env"
    if env_path.exists():
        load_dotenv(env_path)

    root_path = str(Path(__file__).parent.parent)
    if root_path not in sys.path:
        sys.path.insert(0, root_path)

    from tools.storage_manager import (
        load_settings, save_settings, get_settings_masked,
        load_history, get_test_plan, delete_test_plan, get_stats,
        get_persistence_mode, get_supabase,
    )
    from tools.jira_client import fetch_issue, test_connection as jira_test_connection
    from tools.llm_client import test_connection as llm_test_connection
    from tools.test_plan_generator import generate_test_plan, parse_test_cases
    from tools.export_engine import to_docx, to_pdf

except Exception:
    BOOTSTRAP_ERROR = traceback.format_exc()


@app.route("/api/bootstrap-check")
def bootstrap_check():
    if BOOTSTRAP_ERROR:
        return (
            f"<pre>BOOTSTRAP CRASH:\n{BOOTSTRAP_ERROR}\n\n"
            f"PATH: {os.getcwd()}\nSYS.PATH: {sys.path}</pre>",
            500,
        )
    return jsonify({"status": "ok", "message": "Bootstrap successful"}), 200


# ── Response helpers ─────────────────────────────────────────────────────────

def ok(data=None, **kwargs):
    payload = {"success": True}
    if data is not None:
        payload["data"] = data
    payload.update(kwargs)
    return jsonify(payload)


def err(message: str, status: int = 400):
    return jsonify({"success": False, "error": message}), status


# ── Auth endpoints ────────────────────────────────────────────────────────────

@app.route("/api/auth/login", methods=["POST"])
def auth_login():
    body = request.get_json(force=True) or {}
    email = (body.get("email") or "").strip()
    password = body.get("password") or ""
    if not email or not password:
        return err("Email and password are required")

    url = _supabase_url()
    key = _supabase_key()
    if not url or not key:
        return err("Auth service not configured", 503)

    try:
        payload = json.dumps({"email": email, "password": password}).encode()
        req = urllib.request.Request(
            f"{url}/auth/v1/token?grant_type=password",
            data=payload,
            headers={"Content-Type": "application/json", "apikey": key},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            auth_data = json.loads(resp.read().decode())

        access_token = auth_data.get("access_token")
        user_data = auth_data.get("user", {})
        user_id = user_data.get("id")
        if not access_token or not user_id:
            return err("Login failed", 401)

        # Fetch role via SECURITY DEFINER RPC (bypasses anon PostgREST restrictions)
        profile = _fetch_profile(user_id)
        if not profile:
            return err("User profile not found. Contact your admin.", 403)

        return ok({
            "access_token": access_token,
            "user": {
                "id": user_id,
                "email": user_data.get("email", email),
                "role": profile.get("role", "normal"),
                "full_name": profile.get("full_name", ""),
            },
        })

    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read().decode()).get("error_description") or "Invalid credentials"
        except Exception:
            msg = "Invalid credentials"
        return err(msg, 401 if e.code in (400, 401) else 500)
    except Exception as e:
        return err(f"Login failed: {e}", 500)


@app.route("/api/auth/me", methods=["GET"])
@require_auth("normal")
def auth_me():
    profile = request.auth_profile
    user = request.auth_user
    return ok({
        "id": user.get("id"),
        "email": user.get("email"),
        "role": profile.get("role", "normal"),
        "full_name": profile.get("full_name", ""),
    })


# ── User management (admin only) ─────────────────────────────────────────────

@app.route("/api/users", methods=["GET"])
@require_auth("admin")
def users_list():
    try:
        rows = _rpc("list_user_profiles", {})
        return ok(rows)
    except Exception as e:
        return err(str(e), 500)


@app.route("/api/users", methods=["POST"])
@require_auth("admin")
def users_create():
    body = request.get_json(force=True) or {}
    email     = (body.get("email") or "").strip()
    password  = body.get("password") or ""
    role      = body.get("role", "normal")
    full_name = (body.get("full_name") or "").strip()

    if not email or not password:
        return err("Email and password are required")
    if role not in ("normal", "developer", "admin"):
        return err("Invalid role. Must be normal, developer, or admin.")

    # Create auth user via admin API (requires SUPABASE_SERVICE_KEY)
    user_data, error = _admin_rest("POST", "users", {
        "email": email,
        "password": password,
        "email_confirm": True,
        "user_metadata": {"full_name": full_name},
    })
    if error:
        return err(f"User creation failed: {error}", 500)

    new_user_id = user_data.get("id")
    if not new_user_id:
        return err("User creation failed: no ID returned", 500)

    try:
        # Trigger may already have created the row; upsert to set role + full_name
        _rpc("upsert_user_profile", {
            "p_user_id": new_user_id,
            "p_email": email,
            "p_full_name": full_name,
            "p_role": role,
        })
    except Exception as e:
        print(f"[auth] Profile upsert after create failed: {e}", file=sys.stderr)

    return ok({"id": new_user_id, "email": email, "role": role, "full_name": full_name})


@app.route("/api/users/<string:user_id>", methods=["PUT"])
@require_auth("admin")
def users_update(user_id: str):
    if not _valid_user_id(user_id):
        return err("Invalid user id.")
    body = request.get_json(force=True) or {}
    role      = body.get("role")
    full_name = body.get("full_name")

    if role and role not in ("normal", "developer", "admin"):
        return err("Invalid role.")

    params: dict = {"p_user_id": user_id}
    if role:
        params["p_role"] = role
    if full_name is not None:
        params["p_full_name"] = str(full_name).strip()
    if len(params) == 1:
        return err("Nothing to update")

    try:
        rows = _rpc("update_user_profile", params)
        if not rows:
            return err("User not found", 404)
        return ok(rows[0])
    except Exception as e:
        return err(str(e), 500)


@app.route("/api/users/<string:user_id>", methods=["DELETE"])
@require_auth("admin")
def users_delete(user_id: str):
    if not _valid_user_id(user_id):
        return err("Invalid user id.")
    if request.auth_user.get("id") == user_id:
        return err("Cannot delete your own account.", 400)

    result, error = _admin_rest("DELETE", f"users/{user_id}")
    if error and "not found" not in str(error).lower():
        return err(f"Delete failed: {error}", 500)
    return ok({"deleted": user_id})


# ── Dashboard ─────────────────────────────────────────────────────────────────

@app.route("/api/stats", methods=["GET"])
@require_auth("normal")
def stats():
    try:
        return ok(get_stats())
    except Exception as e:
        return err(str(e), 500)


# ── Jira ──────────────────────────────────────────────────────────────────────

@app.route("/api/jira/issue/<string:issue_id>", methods=["GET"])
@require_auth("normal")
def jira_issue(issue_id: str):
    if not _valid_jira_id(issue_id):
        return err("Invalid Jira issue id. Expected format like ABC-123.")
    try:
        settings = load_settings()
        issue = fetch_issue(issue_id.upper(), settings)
        return ok(issue)
    except ValueError as e:
        return err(str(e), 400)
    except Exception as e:
        return err(f"Unexpected error: {e}", 500)


# ── Generate ──────────────────────────────────────────────────────────────────

@app.route("/api/generate", methods=["POST"])
@require_auth("developer")
def generate():
    try:
        body = request.get_json(force=True) or {}
        jira_issue_id = (body.get("jira_issue_id") or "").strip()
        if not jira_issue_id:
            return err("jira_issue_id is required")
        if not _valid_jira_id(jira_issue_id):
            return err("Invalid Jira issue id. Expected format like ABC-123.")
        body["jira_issue_id"] = jira_issue_id.upper()
        record = generate_test_plan(body, save=False)
        return ok(record)
    except ValueError as e:
        return err(str(e), 400)
    except RuntimeError as e:
        return err(str(e), 502)
    except Exception as e:
        return err(f"Unexpected error: {e}", 500)


@app.route("/api/history", methods=["POST"])
@require_auth("developer")
def history_save():
    """Save a generated plan to the database after user review."""
    try:
        from tools.storage_manager import save_test_plan
        body = request.get_json(force=True) or {}
        if not body.get("id"):
            return err("Plan id is required")
        # Re-parse test cases from potentially edited markdown
        markdown = body.get("content", {}).get("markdown", "")
        if markdown:
            tcs_reparsed = parse_test_cases(markdown)
            # Preserve playwright_script and reviewed state from existing test cases
            existing_map = {tc["id"]: tc for tc in body.get("content", {}).get("test_cases", [])}
            for tc in tcs_reparsed:
                if tc["id"] in existing_map:
                    tc["playwright_script"] = existing_map[tc["id"]].get("playwright_script", "")
                    tc["reviewed"] = existing_map[tc["id"]].get("reviewed", False)
            body["content"]["test_cases"] = tcs_reparsed
            body["test_case_count"] = len(tcs_reparsed)
        save_test_plan(body)
        return ok(body)
    except Exception as e:
        return err(str(e), 500)


@app.route("/api/history/<string:plan_id>", methods=["PUT"])
@require_auth("developer")
def history_update(plan_id):
    """Update an existing plan's markdown and re-parse test cases."""
    try:
        if not _valid_plan_id(plan_id):
            return err("Invalid plan id")
        from tools.storage_manager import save_test_plan
        record = get_test_plan(plan_id)
        if not record:
            return err("Plan not found", 404)
        body = request.get_json(force=True) or {}
        markdown = body.get("markdown", "").strip()
        if not markdown:
            return err("markdown is required")
        # Re-parse test cases, preserving scripts and reviewed state
        tcs_reparsed = parse_test_cases(markdown)
        existing_map = {tc["id"]: tc for tc in record.get("content", {}).get("test_cases", [])}
        for tc in tcs_reparsed:
            if tc["id"] in existing_map:
                tc["playwright_script"] = existing_map[tc["id"]].get("playwright_script", "")
                tc["reviewed"] = existing_map[tc["id"]].get("reviewed", False)
        record["content"]["markdown"] = markdown
        record["content"]["test_cases"] = tcs_reparsed
        record["test_case_count"] = len(tcs_reparsed)
        save_test_plan(record)
        return ok(record)
    except Exception as e:
        return err(str(e), 500)


# ── History ───────────────────────────────────────────────────────────────────

@app.route("/api/history", methods=["GET"])
@require_auth("normal")
def history():
    try:
        q = request.args.get("q", "").lower()
        f = request.args.get("filter", "all")

        records = load_history()
        records = sorted(records, key=lambda r: r.get("generated_at", ""), reverse=True)

        if f == "week":
            records = [r for r in records if _within_days(r.get("generated_at", ""), 7)]
        elif f == "month":
            records = [r for r in records if _within_days(r.get("generated_at", ""), 30)]
        elif f == "starred":
            records = [r for r in records if r.get("starred", False)]

        if q:
            records = [
                r for r in records
                if q in r.get("jira_id", "").lower()
                or q in r.get("jira_title", "").lower()
                or q in r.get("title", "").lower()
            ]

        summary = [{
            "id": r["id"],
            "jira_id": r.get("jira_id", ""),
            "jira_title": r.get("jira_title", ""),
            "title": r.get("title", ""),
            "llm_provider": r.get("llm_provider", ""),
            "llm_model": r.get("llm_model", ""),
            "status": r.get("status", ""),
            "generated_at": r.get("generated_at", ""),
            "test_case_count": r.get("test_case_count", 0),
            "generation_time_seconds": r.get("generation_time_seconds", 0),
            "starred": r.get("starred", False),
        } for r in records]

        return ok(summary)
    except Exception as e:
        return err(str(e), 500)


@app.route("/api/history/<string:plan_id>", methods=["GET"])
@require_auth("normal")
def history_detail(plan_id: str):
    if not _valid_plan_id(plan_id):
        return err("Invalid plan id.")
    try:
        record = get_test_plan(plan_id)
        if not record:
            return err(f"Test plan '{plan_id}' not found", 404)
        return ok(record)
    except Exception as e:
        return err(str(e), 500)


@app.route("/api/history/<string:plan_id>", methods=["DELETE"])
@require_auth("admin")
def history_delete(plan_id: str):
    if not _valid_plan_id(plan_id):
        return err("Invalid plan id.")
    try:
        deleted = delete_test_plan(plan_id)
        if not deleted:
            return err(f"Test plan '{plan_id}' not found", 404)
        return ok({"deleted": plan_id})
    except Exception as e:
        return err(str(e), 500)


@app.route("/api/history/<string:plan_id>/star", methods=["PATCH"])
@require_auth("developer")
def history_star(plan_id: str):
    if not _valid_plan_id(plan_id):
        return err("Invalid plan id.")
    try:
        from tools.storage_manager import save_test_plan
        record = get_test_plan(plan_id)
        if not record:
            return err(f"Test plan '{plan_id}' not found", 404)
        record["starred"] = not record.get("starred", False)
        save_test_plan(record)
        return ok({"starred": record["starred"]})
    except Exception as e:
        return err(str(e), 500)


# ── Test Cases ────────────────────────────────────────────────────────────────

@app.route("/api/test-cases", methods=["GET"])
@require_auth("normal")
def all_test_cases():
    try:
        records = load_history()
        test_cases = []
        for r in records:
            tcs = r.get("content", {}).get("test_cases", [])
            for tc in tcs:
                tc_copy = dict(tc)
                tc_copy["plan_id"] = r["id"]
                tc_copy["jira_id"] = r.get("jira_id", "")
                tc_copy["jira_title"] = r.get("jira_title", "")
                tc_copy["generated_at"] = r.get("generated_at", "")
                test_cases.append(tc_copy)
        test_cases.sort(key=lambda x: x.get("generated_at", ""), reverse=True)
        return ok(test_cases)
    except Exception as e:
        return err(str(e), 500)


@app.route("/api/test-cases/<string:plan_id>", methods=["POST"])
@require_auth("developer")
def tc_create(plan_id: str):
    if not _valid_plan_id(plan_id):
        return err("Invalid plan id.")
    try:
        from tools.storage_manager import save_test_plan
        record = get_test_plan(plan_id)
        if not record:
            return err("Plan not found", 404)
        body = request.get_json(force=True) or {}
        tcs = record.get("content", {}).setdefault("test_cases", [])
        max_num = 0
        for tc in tcs:
            if tc.get("id", "").startswith("TC-"):
                try:
                    max_num = max(max_num, int(tc["id"].replace("TC-", "")))
                except (ValueError, TypeError):
                    continue
        new_id = f"TC-{max_num + 1:03d}"
        new_tc = {
            "id": new_id,
            "title": body.get("title", "New Test Case"),
            "priority": body.get("priority", "Medium"),
            "type": body.get("type", "Positive"),
            "preconditions": body.get("preconditions", []),
            "steps": body.get("steps", []),
            "expected_result": body.get("expected_result", ""),
            "test_data": body.get("test_data", {}),
        }
        tcs.append(new_tc)
        record["test_case_count"] = len(tcs)
        save_test_plan(record)
        return ok(new_tc)
    except Exception as e:
        return err(str(e), 500)


@app.route("/api/test-cases/<string:plan_id>/<string:tc_id>", methods=["PUT"])
@require_auth("developer")
def tc_update(plan_id: str, tc_id: str):
    if not _valid_plan_id(plan_id) or not _valid_tc_id(tc_id):
        return err("Invalid plan or test case id.")
    try:
        from tools.storage_manager import save_test_plan
        record = get_test_plan(plan_id)
        if not record:
            return err("Plan not found", 404)
        body = request.get_json(force=True) or {}
        tcs = record.get("content", {}).get("test_cases", [])
        for idx, tc in enumerate(tcs):
            if tc.get("id") == tc_id:
                tcs[idx] = body
                record["content"]["test_cases"] = tcs
                save_test_plan(record)
                return ok(body)
        return err("Test case not found", 404)
    except Exception as e:
        return err(str(e), 500)


@app.route("/api/test-cases/<string:plan_id>/<string:tc_id>", methods=["DELETE"])
@require_auth("developer")
def tc_delete(plan_id: str, tc_id: str):
    if not _valid_plan_id(plan_id) or not _valid_tc_id(tc_id):
        return err("Invalid plan or test case id.")
    try:
        from tools.storage_manager import save_test_plan
        record = get_test_plan(plan_id)
        if not record:
            return err("Plan not found", 404)
        tcs = record.get("content", {}).get("test_cases", [])
        new_tcs = [tc for tc in tcs if tc.get("id") != tc_id]
        if len(new_tcs) == len(tcs):
            return err("Test case not found", 404)
        record["content"]["test_cases"] = new_tcs
        record["test_case_count"] = len(new_tcs)
        save_test_plan(record)
        return ok({"deleted": tc_id})
    except Exception as e:
        return err(str(e), 500)


@app.route("/api/generate-script/<string:plan_id>/<string:tc_id>", methods=["POST"])
@require_auth("developer")
def generate_script(plan_id: str, tc_id: str):
    if not _valid_plan_id(plan_id) or not _valid_tc_id(tc_id):
        return err("Invalid plan or test case id.")
    try:
        from tools.storage_manager import save_test_plan
        from tools.llm_client import generate

        record = get_test_plan(plan_id)
        if not record:
            return err("Plan not found", 404)
        tcs = record.get("content", {}).get("test_cases", [])
        tc = next((t for t in tcs if t.get("id") == tc_id), None)
        if not tc:
            return err("Test case not found", 404)

        settings = load_settings()
        body = request.get_json(force=True) or {}
        provider = body.get("provider") or settings.get("llm", {}).get("active_provider", "openai")

        playwright_cfg = settings.get("templates", {}).get("playwright_prompt", "").strip()
        system_prompt = playwright_cfg or DEFAULT_PLAYWRIGHT_PROMPT
        prompt = (
            f"Generate a pure Playwright TypeScript test for the following test case:\n"
            f"Title: {tc.get('title')}\n"
            f"Preconditions: {', '.join(tc.get('preconditions', []))}\n"
            f"Steps: {', '.join(tc.get('steps', []))}\n"
            f"Expected Result: {tc.get('expected_result')}\n"
            f"Test Data: {json.dumps(tc.get('test_data', {}))}\n\n"
            "Return valid TypeScript code starting with import { test, expect } from '@playwright/test';"
        )

        script = generate(prompt, system_prompt, provider, settings).strip()

        if script.startswith("```"):
            lines = script.split("\n")
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            script = "\n".join(lines).strip()

        tc["playwright_script"] = script
        record["content"]["test_cases"] = tcs
        save_test_plan(record)
        return ok({"playwright_script": script})
    except Exception as e:
        return err(str(e), 500)


# ── Export ────────────────────────────────────────────────────────────────────

@app.route("/api/export-scripts", methods=["POST"])
@require_auth("developer")
def export_scripts():
    try:
        import io, zipfile
        body = request.get_json(force=True) or {}
        scripts = body.get("scripts", [])
        if not scripts:
            return err("No scripts provided", 400)

        grouped = {}
        for s in scripts:
            jid = s.get("jira_id") or "UNCATEGORIZED"
            grouped.setdefault(jid, []).append(s)

        mem_zip = io.BytesIO()
        with zipfile.ZipFile(mem_zip, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
            for jid, items in grouped.items():
                content = "import { test, expect } from '@playwright/test';\n\n"
                for tc in items:
                    content += f"// ==========================================\n"
                    content += f"// {tc.get('tc_id', '')} - {tc.get('title', '')}\n"
                    content += f"// ==========================================\n\n"
                    script = tc.get("playwright_script", "")
                    clean = [l for l in script.split("\n") if not l.startswith("import { test")]
                    content += "\n".join(clean).strip() + "\n\n"
                zf.writestr(f"{jid}.spec.ts", content)

        mem_zip.seek(0)
        return send_file(
            mem_zip,
            mimetype="application/zip",
            as_attachment=True,
            download_name="playwright_scripts.zip",
        )
    except Exception as e:
        return err(f"Export failed: {e}", 500)


@app.route("/api/export/<string:plan_id>/<string:fmt>", methods=["GET"])
@require_auth("normal")
def export(plan_id: str, fmt: str):
    if fmt not in ("docx", "pdf"):
        return err("Format must be 'docx' or 'pdf'")
    if not _valid_plan_id(plan_id):
        return err("Invalid plan id.")
    try:
        record = get_test_plan(plan_id)
        if not record:
            return err(f"Test plan '{plan_id}' not found", 404)
        if fmt == "docx":
            buffer = to_docx(record, output_path="buffer")
            mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            ext = "docx"
        else:
            buffer = to_pdf(record, output_path="buffer")
            mime = "application/pdf"
            ext = "pdf"
        date_str = datetime.now().strftime("%Y%m%d")
        filename = f"{record['jira_id']}_{date_str}.{ext}"
        return send_file(buffer, mimetype=mime, as_attachment=True, download_name=filename)
    except Exception as e:
        return err(f"Export failed: {e}", 500)


# ── Settings ──────────────────────────────────────────────────────────────────

@app.route("/api/settings/providers", methods=["GET"])
@require_auth("normal")
def settings_providers():
    try:
        settings = load_settings()
        active = settings.get("llm", {}).get("active_provider", "openai")
        providers = settings.get("llm", {}).get("providers", {})
        result = []
        for key, cfg in providers.items():
            has_key = bool(cfg.get("api_key", "")) and cfg.get("api_key", "") != ""
            if key == "local_llm":
                has_key = True
            result.append({"id": key, "model": cfg.get("model", ""), "has_key": has_key, "active": key == active})
        return ok({"active_provider": active, "providers": result})
    except Exception as e:
        return err(str(e), 500)


@app.route("/api/settings/active-provider", methods=["PATCH"])
@require_auth("developer")
def settings_active_provider():
    try:
        body = request.get_json(force=True) or {}
        provider = body.get("provider", "").strip()
        if not provider:
            return err("provider is required")
        settings = load_settings()
        known = settings.get("llm", {}).get("providers", {})
        if provider not in known:
            return err(f"Unknown provider: '{provider}'")
        cfg = known[provider]
        settings["llm"]["active_provider"] = provider
        save_settings(settings)
        return ok({"active_provider": provider, "model": cfg.get("model", "")})
    except Exception as e:
        return err(str(e), 500)


@app.route("/api/settings", methods=["GET"])
@require_auth("normal")
def settings_get():
    try:
        data = get_settings_masked()
        data["_persistence"] = get_persistence_mode()
        return ok(data)
    except Exception as e:
        return err(f"{e} - {traceback.format_exc()}", 500)


@app.route("/api/settings/persistence-mode", methods=["GET"])
@require_auth("normal")
def settings_persistence():
    try:
        return ok(get_persistence_mode())
    except Exception as e:
        return err(str(e), 500)


@app.route("/api/settings", methods=["PUT"])
@require_auth("developer")
def settings_put():
    try:
        incoming = request.get_json(force=True) or {}
        current = load_settings()
        _merge_preserving_masked(current, incoming)
        save_settings(current)
        return ok(get_settings_masked())
    except Exception as e:
        return err(str(e), 500)


def _merge_preserving_masked(current: dict, incoming: dict, path=""):
    for key, value in incoming.items():
        if isinstance(value, dict) and isinstance(current.get(key), dict):
            _merge_preserving_masked(current[key], value, path=f"{path}.{key}")
        elif isinstance(value, str) and value.startswith("••"):
            pass
        else:
            current[key] = value


@app.route("/api/settings/templates", methods=["GET"])
@require_auth("normal")
def templates_get():
    try:
        from tools.test_plan_generator import SYSTEM_PROMPT as DEFAULT_PLAN_PROMPT
        settings = load_settings()
        stored = settings.get("templates", {})
        custom_plan = stored.get("test_plan_prompt", "").strip()
        custom_pw   = stored.get("playwright_prompt", "").strip()
        return ok({
            "test_plan_prompt": custom_plan or DEFAULT_PLAN_PROMPT,
            "playwright_prompt": custom_pw or DEFAULT_PLAYWRIGHT_PROMPT,
            "is_custom": {
                "test_plan_prompt": bool(custom_plan),
                "playwright_prompt": bool(custom_pw),
            },
            "defaults": {
                "test_plan_prompt": DEFAULT_PLAN_PROMPT,
                "playwright_prompt": DEFAULT_PLAYWRIGHT_PROMPT,
            },
        })
    except Exception as e:
        return err(str(e), 500)


@app.route("/api/settings/templates", methods=["PUT"])
@require_auth("admin")
def templates_put():
    try:
        body = request.get_json(force=True) or {}
        save_settings({"templates": {
            "test_plan_prompt": body.get("test_plan_prompt", "").strip(),
            "playwright_prompt": body.get("playwright_prompt", "").strip(),
        }})
        return ok({"saved": True})
    except Exception as e:
        return err(str(e), 500)


@app.route("/api/settings/test-connection", methods=["POST"])
@require_auth("developer")
def settings_test():
    try:
        body = request.get_json(force=True) or {}
        connection_type = body.get("type", "llm")
        settings = load_settings()
        if connection_type == "jira":
            result = jira_test_connection(settings)
            if not result.get("ok"):
                result["details"] = f"Key Source: {settings['jira'].get('_source', 'Unknown')}"
        else:
            provider = body.get("provider", settings["llm"]["active_provider"])
            result = llm_test_connection(provider, settings)
            if not result.get("ok"):
                provider_cfg = settings["llm"]["providers"].get(provider, {})
                result["details"] = (
                    f"Source: {provider_cfg.get('_source', 'Unknown')} | "
                    f"Key Preview: {_mask_preview(provider_cfg.get('api_key'))}"
                )
        return ok(result)
    except Exception as e:
        return err(str(e), 500)


@app.route("/api/debug-config", methods=["GET"])
@require_auth("admin")
def debug_config():
    settings = load_settings()
    debug = {
        "jira": {
            "source": settings["jira"].get("_source"),
            "token_preview": _mask_preview(settings["jira"].get("api_token")),
            "email": settings["jira"].get("email"),
        },
        "llm_providers": {},
    }
    for p, cfg in settings.get("llm", {}).get("providers", {}).items():
        debug["llm_providers"][p] = {
            "source": cfg.get("_source"),
            "key_preview": _mask_preview(cfg.get("api_key")),
            "model": cfg.get("model"),
        }
    return ok(debug)


def _mask_preview(key):
    if not key or not isinstance(key, str) or len(key) < 6:
        return "MISSING/SHORT"
    return f"{key[:3]}...{key[-3:]} (len: {len(key)})"


# ── Helpers ───────────────────────────────────────────────────────────────────

def _within_days(iso_str: str, days: int) -> bool:
    try:
        from datetime import timezone, timedelta
        dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        return dt >= cutoff
    except Exception:
        return False


# ── Entry Point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("[Testurai] API starting on http://localhost:5000")
    app.run(debug=True, port=5000, host="0.0.0.0")
