#!/usr/bin/env python3
"""
Figma to Local Bridge Server (Multi-Threaded, Rock-Solid Edition)
Receives exported assets (Screenshots 2x, SVGs, Images, Full DOM CSS specs, Design Tokens, Component Catalog)
from the Figma Exporter Plugin and organizes them into structured folders for AI agents.
Uses ThreadingHTTPServer for high concurrency and resilience against socket disconnects.
Automatically aggregates:
  - figma/exports/DESIGN_SYSTEM_CATALOG.json
  - figma/exports/DESIGN_SYSTEM_GUIDE.md
  - figma/exports/FONTS_SETUP.md
Zero external dependencies (standard Python 3 library only).
"""

import os
import re
import json
import base64
import socket
import hashlib
import threading
from pathlib import Path
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

PORT = int(os.environ.get("FIGMA_EXPORT_PORT", "3055"))
BASE_DIR = Path(__file__).resolve().parent
EXPORTS_DIR = Path(os.environ.get("FIGMA_EXPORT_DIR", BASE_DIR / "exports")).resolve()
PROJECT_ID = os.environ.get("FIGMA_PROJECT_ID", "legacy-local")
WRITE_LOCK = threading.Lock()
MANIFEST_FILE = EXPORTS_DIR / "export-manifest.json"
CATALOG_FILE = EXPORTS_DIR / "DESIGN_SYSTEM_CATALOG.json"
GUIDE_FILE = EXPORTS_DIR / "DESIGN_SYSTEM_GUIDE.md"
FONTS_FILE = EXPORTS_DIR / "FONTS_SETUP.md"

def sanitize_name(name: str) -> str:
    """Sanitize directory/file names while preserving readability."""
    cleaned = re.sub(r'[\\*?:"<>|]', "_", name).strip()
    return cleaned.replace("/", "_") if cleaned not in ("", ".", "..") else "unnamed"

def contained_path(root, parts):
    target = root.joinpath(*parts)
    if not target.resolve().is_relative_to(root.resolve()):
        raise ValueError("Export path escapes output directory")
    return target


def resolve_target(payload):
    document = payload.get("document")
    nodes = payload.get("node_path")
    if not document or not document.get("id") or not nodes:
        if PROJECT_ID != "legacy-local":
            raise ValueError("Plugin update required: document identity and node_path are missing")
        return contained_path(EXPORTS_DIR, [sanitize_name(p) for p in payload.get("folder_path", []) if p])
    manifest = json.loads(MANIFEST_FILE.read_text()) if MANIFEST_FILE.exists() else {
        "version": 1, "projectId": PROJECT_ID, "documents": {}
    }
    if manifest.get("projectId") != PROJECT_ID:
        raise ValueError("Output directory belongs to a different project")
    docs = manifest["documents"]
    doc_id = str(document["id"])
    def suffix(value):
        return hashlib.sha256(value.encode()).hexdigest()[:12]
    doc = docs.setdefault(doc_id, {
        "path": sanitize_name(document.get("name", "Figma")) + "--" + suffix(doc_id), "nodes": {}
    })
    doc["name"] = document.get("name", "Figma")
    parts = [doc["path"]]
    parent_id = None
    for node in nodes:
        node_id = str(node["id"])
        entry = doc["nodes"].get(node_id)
        if entry is None:
            parts.append(sanitize_name(node["name"]) + "--" + suffix(node_id))
            entry = {"path": "/".join(parts)}
            doc["nodes"][node_id] = entry
        else:
            # Keep original location even after a rename or reparenting.
            parts = entry["path"].split("/")
        entry.update(name=node["name"], parentId=parent_id)
        parent_id = node_id
    target = contained_path(EXPORTS_DIR, parts)
    temporary = MANIFEST_FILE.with_suffix(".tmp")
    temporary.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    temporary.replace(MANIFEST_FILE)
    return target


def update_global_fonts_guide(fonts_guide_data: dict):
    """Aggregate font information and maintain a master FONTS_SETUP.md."""
    try:
        html_link = fonts_guide_data.get("htmlLinkTag", "")
        css_import = fonts_guide_data.get("cssImportRule", "")
        font_stack = fonts_guide_data.get("cssFontFamilyStack", "")
        fonts_list = fonts_guide_data.get("fonts", [])

        md_content = f"""# 🔤 Project Fonts & Typography Setup

> Tệp này được tự động tạo và cập nhật từ Figma AI Exporter.
> Giao diện project sử dụng bộ font chính thức dưới đây.

## 1. Danh sách Fonts sử dụng
"""
        for item in fonts_list:
            weights_str = ", ".join([f"`{w}`" for w in item.get("weights", [])])
            md_content += f"- **Font Family:** `{item.get('family')}` | **Weights:** {weights_str}\n"

        md_content += f"""
---

## 2. Mã nhúng nhanh cho AI Agent & Developers

### Cách 1: Thêm vào `<head>` của file HTML
```html
{html_link}
```

### Cách 2: Thêm vào file CSS toàn cục (`styles.css` hoặc `globals.css`)
```css
{css_import}

:root {{
  --font-sans: {font_stack};
}}

body {{
  font-family: var(--font-sans);
}}
```

### Cách 3: Cấu hình Tailwind CSS (`tailwind.config.js`)
```javascript
module.exports = {{
  theme: {{
    extend: {{
      fontFamily: {{
        sans: [{font_stack}],
      }},
    }},
  }},
}};
```
"""
        with open(FONTS_FILE, "w", encoding="utf-8") as f:
            f.write(md_content)

        print(f"🔤 [FONTS] Updated {FONTS_FILE.name}")
    except Exception as e:
        print(f"⚠️ Warning: Failed to update fonts guide: {e}")

def update_global_design_system_catalog(screen_rel_path: str, components_used: dict):
    """Aggregate screen-level components_used into a global project design system catalog."""
    try:
        catalog = {}
        if CATALOG_FILE.exists():
            with open(CATALOG_FILE, "r", encoding="utf-8") as f:
                catalog = json.load(f)

        for comp_name, comp_data in components_used.items():
            if comp_name not in catalog:
                catalog[comp_name] = {
                    "componentSet": comp_name,
                    "description": comp_data.get("description", "Shared Design System Component"),
                    "totalUsageCount": 0,
                    "variantsEncountered": [],
                    "screensUsedIn": [],
                    "sampleSnippets": [],
                    "reuseRules": comp_data.get("reuseRules", f"Always reuse <{comp_name}>. Do not create duplicate markup.")
                }

            entry = catalog[comp_name]
            entry["totalUsageCount"] += comp_data.get("totalUsageCount", 1)

            if screen_rel_path not in entry["screensUsedIn"]:
                entry["screensUsedIn"].append(screen_rel_path)

            # Merge variants
            for new_var in comp_data.get("variantsEncountered", []):
                new_var_props = new_var.get("properties", {})
                exists = False
                for existing in entry["variantsEncountered"]:
                    if existing.get("properties") == new_var_props:
                        existing["count"] = existing.get("count", 0) + new_var.get("count", 1)
                        exists = True
                        break
                if not exists:
                    entry["variantsEncountered"].append(new_var)

            # Merge snippets
            for sample in comp_data.get("sampleUsages", []):
                snippet = sample.get("recommendedSnippet")
                if snippet and snippet not in entry["sampleSnippets"]:
                    entry["sampleSnippets"].append(snippet)

        with open(CATALOG_FILE, "w", encoding="utf-8") as f:
            json.dump(catalog, f, indent=2, ensure_ascii=False)

        # Generate markdown guide
        generate_design_system_markdown_guide(catalog)

    except Exception as e:
        print(f"⚠️ Warning: Failed to update global design system catalog: {e}")

def generate_design_system_markdown_guide(catalog: dict):
    """Generate high-clarity markdown documentation for AI agents to reuse components."""
    try:
        lines = [
            "# 🧩 Project Design System & Component Reuse Guide",
            "",
            "> **CRITICAL DIRECTIVE FOR AI AGENTS:**",
            "> When implementing or refactoring any screen in this project, **YOU MUST CONSULT THIS CATALOG FIRST**.",
            "> If a UI requirement matches any of the shared components below, **REUSE THE COMPONENT**.",
            "> **DO NOT** write custom, ad-hoc `<div>`, `<button>`, or styling for these elements.",
            "",
            "## 1. Quick Component Index",
            "",
            "| Component Name | Total Usage | Screens Count | Variants Available | Primary Recommended Code |",
            "| :--- | :--- | :--- | :--- | :--- |"
        ]

        for name, item in sorted(catalog.items(), key=lambda x: x[1]["totalUsageCount"], reverse=True):
            usages = item.get("totalUsageCount", 0)
            screens_cnt = len(item.get("screensUsedIn", []))
            var_summary = "<br>".join([json.dumps(v.get("properties", {})) for v in item.get("variantsEncountered", [])[:3]])
            if len(item.get("variantsEncountered", [])) > 3:
                var_summary += "<br>*(and more...)*"
            
            snippets = item.get("sampleSnippets", [])
            primary_snippet = f"`{snippets[0]}`" if snippets else f"`<{name} />`"
            lines.append(f"| **`<{name}>`** | `{usages}` | `{screens_cnt}` | {var_summary} | {primary_snippet} |")

        lines.extend([
            "",
            "---",
            "",
            "## 2. Component Specifications & Code Templates",
            ""
        ])

        for name, item in sorted(catalog.items(), key=lambda x: x[1]["totalUsageCount"], reverse=True):
            lines.append(f"### Component: `<{name}>`")
            lines.append(f"- **Description:** {item.get('description', 'Design System Component')}")
            lines.append(f"- **Total Usage across project:** `{item.get('totalUsageCount', 0)}` occurrences")
            lines.append(f"- **Reuse Rule:** {item.get('reuseRules', '')}")
            lines.append("- **Screens where used:**")
            for scr in item.get("screensUsedIn", [])[:6]:
                lines.append(f"  - `{scr}`")
            if len(item.get("screensUsedIn", [])) > 6:
                lines.append(f"  - *...and {len(item.get('screensUsedIn', [])) - 6} more screens*")

            lines.append("\n**Recommended Code Templates:**\n```jsx")
            for snip in item.get("sampleSnippets", [])[:3]:
                lines.append(snip)
            if not item.get("sampleSnippets"):
                lines.append(f"<{name} />")
            lines.append("```\n")

        with open(GUIDE_FILE, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")

        print(f"📘 [CATALOG] Updated {CATALOG_FILE.name} and {GUIDE_FILE.name}")
    except Exception as e:
        print(f"⚠️ Warning: Failed to generate design system guide: {e}")

def checkpoint(payload, target):
    return target / ".export-checkpoint.json"


def is_unchanged(payload, target):
    state_file = checkpoint(payload, target)
    if not state_file.exists() or not payload.get("content_hash"):
        return False
    state = json.loads(state_file.read_text())
    return (state.get("hash") == payload["content_hash"]
            and bool(state.get("files"))
            and all(contained_path(target, [f["name"]]).is_file()
                    and hashlib.sha256(contained_path(target, [f["name"]]).read_bytes()).hexdigest() == f["hash"]
                    for f in state["files"]))


class BridgeHandler(BaseHTTPRequestHandler):
    def safe_send_response(self, status=200, content_type="application/json", body_bytes=b""):
        try:
            self.send_response(status)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body_bytes)))
            self.end_headers()
            if body_bytes:
                self.wfile.write(body_bytes)
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass

    def do_OPTIONS(self):
        self.safe_send_response(204)

    def do_GET(self):
        if self.path == "/" or self.path == "/health":
            res = {
                "status": "ok",
                "message": "Figma Local Bridge (Pixel-Perfect 100% Edition) is running",
                "exports_dir": str(EXPORTS_DIR),
                "project_id": PROJECT_ID,
                "protocol_version": 1
            }
            body = json.dumps(res).encode("utf-8")
            self.safe_send_response(200, "application/json", body)
        else:
            self.safe_send_response(404, "application/json", b'{"error":"not found"}')

    def do_POST(self):
        with WRITE_LOCK:
            self.handle_upload()

    def handle_upload(self):
        if self.path == "/check":
            try:
                payload = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
                if payload.get("project_id") != PROJECT_ID:
                    raise ValueError("Project changed; reconnect plugin")
                target = resolve_target(payload)
                body = json.dumps({"unchanged": is_unchanged(payload, target)}).encode()
                self.safe_send_response(200, "application/json", body)
            except Exception as error:
                self.safe_send_response(400, "application/json", json.dumps({"error": str(error)}).encode())
        elif self.path == "/save":
            try:
                content_length = int(self.headers.get("Content-Length", 0))
                raw_body = self.rfile.read(content_length)
                payload = json.loads(raw_body.decode("utf-8"))

                if payload.get("project_id") != PROJECT_ID and PROJECT_ID != "legacy-local":
                    raise ValueError("Project changed; reconnect plugin before exporting")
                target_dir = resolve_target(payload)
                target_dir.mkdir(parents=True, exist_ok=True)

                state_file = checkpoint(payload, target_dir)
                state_file.unlink(missing_ok=True)
                saved_files = []
                components_used_data = None
                fonts_guide_data = None

                for file_entry in payload.get("files", []):
                    raw_fname = file_entry.get("name", "file")
                    ftype = file_entry.get("type", "text")
                    content = file_entry.get("content", "")

                    # Support relative subpaths like "assets/logo.svg"
                    fname_parts = [sanitize_name(p) for p in raw_fname.split("/") if p]
                    dest_file = contained_path(target_dir, fname_parts)
                    dest_file.parent.mkdir(parents=True, exist_ok=True)

                    if ftype == "base64":
                        binary_data = base64.b64decode(content)
                        with open(dest_file, "wb") as f:
                            f.write(binary_data)
                        size_kb = len(binary_data) / 1024
                        saved_files.append(f"{raw_fname} ({size_kb:.1f} KB)")
                    else:
                        with open(dest_file, "w", encoding="utf-8") as f:
                            f.write(content)
                        saved_files.append(raw_fname)

                        if raw_fname == "components_used.json":
                            try:
                                components_used_data = json.loads(content)
                            except Exception:
                                pass
                        elif raw_fname == "fonts_guide.json":
                            try:
                                fonts_guide_data = json.loads(content)
                            except Exception:
                                pass

                rel_path = target_dir.relative_to(EXPORTS_DIR)
                print(f"✅ [SAVED] {rel_path} -> {len(saved_files)} files saved ({', '.join(saved_files[:4])}...)")

                if components_used_data:
                    update_global_design_system_catalog(str(rel_path), components_used_data)

                if fonts_guide_data:
                    update_global_fonts_guide(fonts_guide_data)

                if payload.get("content_hash"):
                    records = []
                    for item in payload.get("files", []):
                        dest = contained_path(target_dir, [sanitize_name(part) for part in item["name"].split("/") if part])
                        records.append({"name": str(dest.relative_to(target_dir)), "hash": hashlib.sha256(dest.read_bytes()).hexdigest()})
                    temporary = state_file.with_suffix(".tmp")
                    temporary.write_text(json.dumps({"hash": payload["content_hash"], "files": records}))
                    temporary.replace(state_file)
                res = {"success": True, "saved_to": str(target_dir), "files": saved_files}
                self.safe_send_response(200, "application/json", json.dumps(res).encode("utf-8"))

            except Exception as e:
                print(f"❌ [ERROR in /save] {e}")
                err_res = {"success": False, "error": str(e)}
                self.safe_send_response(500, "application/json", json.dumps(err_res).encode("utf-8"))

        elif self.path == "/save-notes":
            try:
                content_length = int(self.headers.get("Content-Length", 0))
                raw_body = self.rfile.read(content_length)
                payload = json.loads(raw_body.decode("utf-8"))

                if payload.get("project_id") != PROJECT_ID and PROJECT_ID != "legacy-local":
                    raise ValueError("Project changed; reconnect plugin before exporting")
                filename = sanitize_name(payload.get("filename", "flow_notes.md"))
                target_dir = resolve_target(payload)
                target_dir.mkdir(parents=True, exist_ok=True)

                dest_file = contained_path(target_dir, [filename])
                with open(dest_file, "w", encoding="utf-8") as f:
                    f.write(payload.get("content", ""))

                rel_file = dest_file.relative_to(EXPORTS_DIR)
                print(f"📝 [NOTES] {rel_file}")

                res = {"success": True, "file": str(dest_file)}
                self.safe_send_response(200, "application/json", json.dumps(res).encode("utf-8"))
            except Exception as e:
                print(f"❌ [ERROR in /save-notes] {e}")
                err_res = {"success": False, "error": str(e)}
                self.safe_send_response(500, "application/json", json.dumps(err_res).encode("utf-8"))
        else:
            self.safe_send_response(404, "application/json", b'{"error":"not found"}')

    def log_message(self, format, *args):
        # Suppress routine health check log spam
        if args and len(args) > 0 and "GET /health" in str(args[0]):
            return
        super().log_message(format, *args)

class RobustThreadingServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

def main():
    EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
    server_address = ("127.0.0.1", PORT)
    try:
        httpd = RobustThreadingServer(server_address, BridgeHandler)
    except OSError as error:
        if error.errno in (48, 98, 10048):
            raise SystemExit(f"Port {PORT} became busy. Run figma-export serve again to resolve the conflict.")
        raise
    use_color = __import__("sys").stdout.isatty() and "NO_COLOR" not in os.environ
    def color(value, code):
        return f"\033[{code}m{value}\033[0m" if use_color else value
    root = Path(os.environ.get("FIGMA_PROJECT_ROOT", BASE_DIR))
    try:
        output_label = "./" + str(EXPORTS_DIR.relative_to(root))
    except ValueError:
        output_label = str(EXPORTS_DIR)
    print()
    print(color("  Figma Export", "1") + "  " + color("● Ready", "32"))
    print()
    print(f"  Project   {root.name}")
    print(f"  Output    {output_label}")
    print(f"  Bridge    http://localhost:{PORT}")
    print()
    print("  Open the Figma plugin to export your designs.")
    print(color("  Ctrl+C to stop", "2"))
    print()

    while True:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n👋 Stopped Bridge Server.")
            break
        except Exception as e:
            print(f"⚠️ Recovered from unexpected server loop exception: {e}")

if __name__ == "__main__":
    main()
