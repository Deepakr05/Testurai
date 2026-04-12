import sys
import json
import traceback
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})

# -- THE SAFETY NET --
BOOTSTRAP_ERROR = None
try:
    from pathlib import Path
    from datetime import datetime
    from dotenv import load_dotenv

    # Load .env IF it exists (don't crash if it doesn't)
    env_path = Path(__file__).parent.parent / ".env"
    if env_path.exists():
        load_dotenv(env_path)

    # Ensure tools/ is importable from root
    root_path = str(Path(__file__).parent.parent)
    if root_path not in sys.path:
        sys.path.insert(0, root_path)

    from tools.storage_manager import (
        load_settings, save_settings, get_settings_masked,
        load_history, get_test_plan, delete_test_plan, get_stats,
        get_persistence_mode,
    )
    from tools.jira_client import fetch_issue, test_connection as jira_test_connection
    from tools.llm_client import test_connection as llm_test_connection
    from tools.test_plan_generator import generate_test_plan
    from tools.export_engine import to_docx, to_pdf

except Exception as e:
    BOOTSTRAP_ERROR = traceback.format_exc()

# Fallback route in case of bootstrap failure
@app.route("/api/bootstrap-check")
def bootstrap_check():
    if BOOTSTRAP_ERROR:
        return f"<pre>BOOTSTRAP CRASH:\n{BOOTSTRAP_ERROR}\n\nPATH: {os.getcwd()}\nSYS.PATH: {sys.path}</pre>", 500
    return jsonify({"status": "ok", "message": "Bootstrap successful"}), 200

# ─── Helpers ──────────────────────────────────────────────────────────────────

def ok(data=None, **kwargs):
    payload = {"success": True}
    if data is not None:
        payload["data"] = data
    payload.update(kwargs)
    return jsonify(payload)


def err(message: str, status: int = 400):
    return jsonify({"success": False, "error": message}), status


# ─── Dashboard ───────────────────────────────────────────────────────────────

@app.route("/api/stats", methods=["GET"])
def stats():
    """Dashboard statistics: total plans, jira issues, avg time, active model."""
    try:
        return ok(get_stats())
    except Exception as e:
        return err(str(e), 500)


# ─── Jira ────────────────────────────────────────────────────────────────────

@app.route("/api/jira/issue/<string:issue_id>", methods=["GET"])
def jira_issue(issue_id: str):
    """Fetch and return a Jira issue preview."""
    try:
        settings = load_settings()
        issue = fetch_issue(issue_id.upper(), settings)
        return ok(issue)
    except ValueError as e:
        return err(str(e), 400)
    except Exception as e:
        return err(f"Unexpected error: {e}", 500)


# ─── Generate ────────────────────────────────────────────────────────────────

@app.route("/api/generate", methods=["POST"])
def generate():
    """
    Full test plan generation pipeline.
    Body: { jira_issue_id, llm_provider, include_sub_tasks, include_negative_cases,
            detail_level, test_plan_format }
    """
    try:
        body = request.get_json(force=True) or {}
        if not body.get("jira_issue_id"):
            return err("jira_issue_id is required")

        record = generate_test_plan(body)
        return ok(record)
    except ValueError as e:
        return err(str(e), 400)
    except RuntimeError as e:
        return err(str(e), 502)
    except Exception as e:
        return err(f"Unexpected error: {e}", 500)


# ─── History ─────────────────────────────────────────────────────────────────

@app.route("/api/history", methods=["GET"])
def history():
    """
    List all test plans, optionally filtered.
    Query params: q (search), filter (all|week|month|starred)
    """
    try:
        q = request.args.get("q", "").lower()
        f = request.args.get("filter", "all")

        records = load_history()
        records = sorted(records, key=lambda r: r.get("generated_at", ""), reverse=True)

        # Filter by date
        now = datetime.utcnow()
        if f == "week":
            records = [r for r in records if _within_days(r.get("generated_at", ""), 7)]
        elif f == "month":
            records = [r for r in records if _within_days(r.get("generated_at", ""), 30)]
        elif f == "starred":
            records = [r for r in records if r.get("starred", False)]

        # Search filter
        if q:
            records = [
                r for r in records
                if q in r.get("jira_id", "").lower()
                or q in r.get("jira_title", "").lower()
                or q in r.get("title", "").lower()
            ]

        # Return summary view (no full markdown for list performance)
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


@app.route("/api/test-cases", methods=["GET"])
def all_test_cases():
    """
    Return a flattened list of all test cases across all plans.
    Used for the Test Cases Dashboard.
    """
    try:
        from tools.storage_manager import load_history
        records = load_history()
        
        test_cases = []
        for r in records:
            tcs = r.get("content", {}).get("test_cases", [])
            for tc in tcs:
                tc_copy = dict(tc)
                # Enrich with plan data
                tc_copy["plan_id"] = r["id"]
                tc_copy["jira_id"] = r.get("jira_id", "")
                tc_copy["jira_title"] = r.get("jira_title", "")
                tc_copy["generated_at"] = r.get("generated_at", "")
                test_cases.append(tc_copy)
                
        # Sort by generated_at descending primarily
        test_cases.sort(key=lambda x: x.get("generated_at", ""), reverse=True)
        return ok(test_cases)
    except Exception as e:
        return err(str(e), 500)


@app.route("/api/test-cases/<string:plan_id>", methods=["POST"])
def tc_create(plan_id: str):
    try:
        from tools.storage_manager import save_test_plan
        record = get_test_plan(plan_id)
        if not record: return err("Plan not found", 404)
        
        body = request.get_json(force=True) or {}
        # Generate new TC-XXX ID based on max existing
        tcs = record.get("content", {}).setdefault("test_cases", [])
        max_num = 0
        for tc in tcs:
            if tc.get("id", "").startswith("TC-"):
                try:
                    num = int(tc["id"].replace("TC-", ""))
                    max_num = max(max_num, num)
                except:
                    pass
        
        new_id = f"TC-{max_num + 1:03d}"
        new_tc = {
            "id": new_id,
            "title": body.get("title", "New Test Case"),
            "priority": body.get("priority", "Medium"),
            "type": body.get("type", "Positive"),
            "preconditions": body.get("preconditions", []),
            "steps": body.get("steps", []),
            "expected_result": body.get("expected_result", ""),
            "test_data": body.get("test_data", {})
        }
        tcs.append(new_tc)
        record["test_case_count"] = len(tcs)
        save_test_plan(record)
        return ok(new_tc)
    except Exception as e:
        return err(str(e), 500)


@app.route("/api/test-cases/<string:plan_id>/<string:tc_id>", methods=["PUT"])
def tc_update(plan_id: str, tc_id: str):
    try:
        from tools.storage_manager import save_test_plan
        record = get_test_plan(plan_id)
        if not record: return err("Plan not found", 404)
        
        body = request.get_json(force=True) or {}
        tcs = record.get("content", {}).get("test_cases", [])
        
        for idx, tc in enumerate(tcs):
            if tc.get("id") == tc_id:
                tcs[idx] = body  # Replace with the updated JSON payload
                record["content"]["test_cases"] = tcs
                save_test_plan(record)
                return ok(body)
                
        return err("Test case not found", 404)
    except Exception as e:
        return err(str(e), 500)


@app.route("/api/test-cases/<string:plan_id>/<string:tc_id>", methods=["DELETE"])
def tc_delete(plan_id: str, tc_id: str):
    try:
        from tools.storage_manager import save_test_plan
        record = get_test_plan(plan_id)
        if not record: return err("Plan not found", 404)
        
        tcs = record.get("content", {}).get("test_cases", [])
        initial_len = len(tcs)
        tcs = [tc for tc in tcs if tc.get("id") != tc_id]
        
        if len(tcs) == initial_len:
            return err("Test case not found", 404)
            
        record["content"]["test_cases"] = tcs
        record["test_case_count"] = len(tcs)
        save_test_plan(record)
        return ok({"deleted": tc_id})
    except Exception as e:
        return err(str(e), 500)


@app.route("/api/generate-script/<string:plan_id>/<string:tc_id>", methods=["POST"])
def generate_script(plan_id: str, tc_id: str):
    try:
        from tools.storage_manager import load_settings, save_test_plan
        from tools.llm_client import generate
        
        record = get_test_plan(plan_id)
        if not record: return err("Plan not found", 404)
        
        tcs = record.get("content", {}).get("test_cases", [])
        tc = next((t for t in tcs if t.get("id") == tc_id), None)
        if not tc: return err("Test case not found", 404)
        
        settings = load_settings()
        provider = settings.get("llm", {}).get("active_provider", "openai")
        
        system_prompt = "You are an expert QA engineer writing robust Playwright TypeScript tests. ONLY return valid TypeScript code. Do not wrap code in markdown fences if possible."
        
        prompt = f"""Generate a pure Playwright TypeScript test for the following test case:
Title: {tc.get('title')}
Preconditions: {', '.join(tc.get('preconditions', []))}
Steps: {', '.join(tc.get('steps', []))}
Expected Result: {tc.get('expected_result')}
Test Data: {json.dumps(tc.get('test_data', {}))}

Return valid TypeScript code starting with import {{ test, expect }} from '@playwright/test';
"""
        
        script = generate(prompt, system_prompt, provider, settings).strip()
        
        # Clean markdown fences
        if script.startswith("```"):
            lines = script.split("\n")
            if len(lines) > 1 and lines[0].startswith("```"):
                lines = lines[1:]
            if len(lines) > 0 and lines[-1].strip() == "```":
                lines = lines[:-1]
            script = "\n".join(lines).strip()
            
        tc["playwright_script"] = script
        record["content"]["test_cases"] = tcs
        save_test_plan(record)
        
        return ok({"playwright_script": script})
    except Exception as e:
        return err(str(e), 500)


@app.route("/api/history/<string:plan_id>", methods=["GET"])
def history_detail(plan_id: str):
    """Get full test plan record including markdown content."""
    try:
        record = get_test_plan(plan_id)
        if not record:
            return err(f"Test plan '{plan_id}' not found", 404)
        return ok(record)
    except Exception as e:
        return err(str(e), 500)


@app.route("/api/history/<string:plan_id>", methods=["DELETE"])
def history_delete(plan_id: str):
    """Delete a test plan by ID."""
    try:
        deleted = delete_test_plan(plan_id)
        if not deleted:
            return err(f"Test plan '{plan_id}' not found", 404)
        return ok({"deleted": plan_id})
    except Exception as e:
        return err(str(e), 500)


@app.route("/api/history/<string:plan_id>/star", methods=["PATCH"])
def history_star(plan_id: str):
    """Toggle starred status on a test plan."""
    try:
        from tools.storage_manager import load_history, save_test_plan
        record = get_test_plan(plan_id)
        if not record:
            return err(f"Test plan '{plan_id}' not found", 404)
        record["starred"] = not record.get("starred", False)
        save_test_plan(record)
        return ok({"starred": record["starred"]})
    except Exception as e:
        return err(str(e), 500)


# ─── Export ───────────────────────────────────────────────────────────────────

@app.route("/api/export-scripts", methods=["POST"])
def export_scripts():
    """Export test scripts as a ZIP grouped by Jira IDs."""
    try:
        import io, zipfile
        body = request.get_json(force=True) or {}
        scripts = body.get("scripts", [])
        
        if not scripts:
            return err("No scripts provided", 400)
            
        grouped = {}
        for s in scripts:
            jid = s.get("jira_id")
            if not jid: 
                jid = "UNCATEGORIZED"
            grouped.setdefault(jid, []).append(s)
            
        mem_zip = io.BytesIO()
        with zipfile.ZipFile(mem_zip, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
            for jid, items in grouped.items():
                file_content = f"import {{ test, expect }} from '@playwright/test';\n\n"
                
                for tc in items:
                    file_content += f"// ==========================================\n"
                    file_content += f"// Test Case: {tc.get('tc_id', '')} - {tc.get('title', '')}\n"
                    file_content += f"// ==========================================\n\n"
                    
                    # Remove any native imports since we injected them at top
                    script = tc.get("playwright_script", "")
                    lines = script.split("\n")
                    clean_lines = [l for l in lines if not l.startswith("import { test")]
                    file_content += "\n".join(clean_lines).strip()
                    file_content += "\n\n"
                    
                zf.writestr(f"{jid}.spec.ts", file_content)
                
        mem_zip.seek(0)
        return send_file(
            mem_zip,
            mimetype="application/zip",
            as_attachment=True,
            download_name="playwright_scripts.zip"
        )
    except Exception as e:
        return err(f"Export failed: {e}", 500)


@app.route("/api/export/<string:plan_id>/<string:fmt>", methods=["GET"])
def export(plan_id: str, fmt: str):
    """Export test plan as docx or pdf. Streams the file."""
    if fmt not in ("docx", "pdf"):
        return err("Format must be 'docx' or 'pdf'")
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
        
        return send_file(
            buffer,
            mimetype=mime,
            as_attachment=True,
            download_name=filename
        )
    except Exception as e:
        return err(f"Export failed: {e}", 500)


# ─── Settings ─────────────────────────────────────────────────────────────────

@app.route("/api/settings/providers", methods=["GET"])
def settings_providers():
    """Lightweight list of LLM providers for sidebar selector."""
    try:
        settings = load_settings()
        active = settings.get("llm", {}).get("active_provider", "openai")
        providers = settings.get("llm", {}).get("providers", {})
        result = []
        for key, cfg in providers.items():
            has_key = bool(cfg.get("api_key", "")) and cfg.get("api_key", "") != ""
            if key == "local_llm":
                has_key = True  # Local LLM doesn't need a real key
            result.append({
                "id": key,
                "model": cfg.get("model", ""),
                "has_key": has_key,
                "active": key == active,
            })
        return ok({"active_provider": active, "providers": result})
    except Exception as e:
        return err(str(e), 500)


@app.route("/api/settings/active-provider", methods=["PATCH"])
def settings_active_provider():
    """Switch the active LLM provider. Only validates key for the selected provider."""
    try:
        body = request.get_json(force=True) or {}
        provider = body.get("provider", "").strip()
        if not provider:
            return err("provider is required")

        settings = load_settings()
        known = settings.get("llm", {}).get("providers", {})
        if provider not in known:
            return err(f"Unknown provider: '{provider}'")

        # Only validate the API key for the provider being selected
        cfg = known[provider]
        if provider != "local_llm" and not cfg.get("api_key", ""):
            return err(
                f"No API key configured for '{provider}'. "
                "Go to Settings → LLM Models to add one.",
                400,
            )

        settings["llm"]["active_provider"] = provider
        save_settings(settings)
        return ok({
            "active_provider": provider,
            "model": cfg.get("model", ""),
        })
    except Exception as e:
        return err(str(e), 500)


@app.route("/api/settings", methods=["GET"])
def settings_get():
    """Return settings with masked API keys plus persistence mode."""
    try:
        data = get_settings_masked()
        data["_persistence"] = get_persistence_mode()
        return ok(data)
    except Exception as e:
        return err(str(e), 500)


@app.route("/api/settings/persistence-mode", methods=["GET"])
def settings_persistence():
    """Return only the persistence mode — useful for the UI banner."""
    try:
        return ok(get_persistence_mode())
    except Exception as e:
        return err(str(e), 500)


@app.route("/api/settings", methods=["PUT"])
def settings_put():
    """
    Save settings. Client sends full settings including NEW (unmasked) keys.
    Masked values (starting with ••) are preserved from current stored settings.
    """
    try:
        incoming = request.get_json(force=True) or {}
        current = load_settings()

        # Merge: if key starts with ••, keep the stored value
        _merge_preserving_masked(current, incoming)

        save_settings(current)
        return ok(get_settings_masked())
    except Exception as e:
        return err(str(e), 500)


def _merge_preserving_masked(current: dict, incoming: dict, path=""):
    """Recursively merge incoming into current, skipping masked (••) values."""
    for key, value in incoming.items():
        if isinstance(value, dict) and isinstance(current.get(key), dict):
            _merge_preserving_masked(current[key], value, path=f"{path}.{key}")
        elif isinstance(value, str) and value.startswith("••"):
            pass  # Keep existing stored value
        else:
            current[key] = value


@app.route("/api/settings/test-connection", methods=["POST"])
def settings_test():
    """
    Test LLM or Jira connection.
    Body: { type: 'llm' | 'jira', provider?: 'openai' | 'anthropic' | 'google' }
    """
    try:
        body = request.get_json(force=True) or {}
        connection_type = body.get("type", "llm")
        settings = load_settings()

        if connection_type == "jira":
            result = jira_test_connection(settings)
            if not result.get("ok"):
                source = settings["jira"].get("_source", "Unknown")
                result["details"] = f"Key Source: {source}"
        else:
            provider = body.get("provider", settings["llm"]["active_provider"])
            result = llm_test_connection(provider, settings)
            if not result.get("ok"):
                provider_cfg = settings["llm"]["providers"].get(provider, {})
                source = provider_cfg.get("_source", "Unknown")
                preview = _mask_preview(provider_cfg.get("api_key"))
                result["details"] = f"Source: {source} | Key Preview: {preview}"

        return ok(result)
    except Exception as e:
        return err(str(e), 500)


@app.route("/api/debug-config", methods=["GET"])
def debug_config():
    """Diagnostic route to trace API key sources (masked for security)."""
    settings = load_settings()
    debug = {
        "jira": {
            "source": settings["jira"].get("_source"),
            "token_preview": _mask_preview(settings["jira"].get("api_token")),
            "email": settings["jira"].get("email")
        },
        "llm_providers": {}
    }
    for p, cfg in settings.get("llm", {}).get("providers", {}).items():
        debug["llm_providers"][p] = {
            "source": cfg.get("_source"),
            "key_preview": _mask_preview(cfg.get("api_key")),
            "model": cfg.get("model")
        }
    return ok(debug)


def _mask_preview(key: str | None) -> str:
    if not key or not isinstance(key, str) or len(key) < 6:
        return "MISSING/SHORT"
    return f"{key[:3]}...{key[-3:]} (len: {len(key)})"


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _within_days(iso_str: str, days: int) -> bool:
    try:
        from datetime import timezone, timedelta
        dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        return dt >= cutoff
    except Exception:
        return False


# ─── Entry Point ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("[TestMaster] API starting on http://localhost:5000")
    app.run(debug=True, port=5000, host="0.0.0.0")
