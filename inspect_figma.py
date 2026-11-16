#!/usr/bin/env python3
import os
import sys
import re
import json
import urllib.request
import urllib.parse
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
ENV_PATH = BASE_DIR / ".env"

def load_env(env_path):
    config = {}
    if not env_path.exists():
        return config
    with open(env_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                k, v = line.split("=", 1)
                k = k.strip()
                v = v.strip().strip("'\"")
                config[k] = v
    return config

def parse_figma_url(url_or_key):
    """
    Parses figma url to extract file_key and optional node_id.
    Handles:
      https://www.figma.com/design/FILE_KEY/NAME?node-id=633-72777...
      https://www.figma.com/file/FILE_KEY/...
    """
    file_key = None
    node_id = None

    url_pattern = r"figma\.com/(?:design|file)/([a-zA-Z0-9]+)"
    match = re.search(url_pattern, url_or_key)
    if match:
        file_key = match.group(1)
        # Parse query params
        parsed = urllib.parse.urlparse(url_or_key)
        params = urllib.parse.parse_qs(parsed.query)
        if "node-id" in params and params["node-id"]:
            # Figma uses 633-72777 in URLs, but API requires 633:72777
            node_id = params["node-id"][0].replace("-", ":")
    else:
        # User passed file_key directly
        file_key = url_or_key

    return file_key, node_id

def sanitize_filename(name):
    return re.sub(r'[\\/*?:"<>| ]', "_", name).strip("_")

def fetch_figma_api(endpoint, token):
    url = f"https://api.figma.com/v1/{endpoint}"
    req = urllib.request.Request(
        url,
        headers={
            "X-Figma-Token": token,
            "User-Agent": "Figma-Inspector/1.0"
        }
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))

def download_image(image_url, save_path):
    save_path.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(image_url, headers={"User-Agent": "Figma-Inspector/1.0"})
    with urllib.request.urlopen(req) as resp, open(save_path, "wb") as f:
        f.write(resp.read())

def extract_node_summary(node, styles_map=None):
    """Recursively extract meaningful specs, texts, and hierarchy."""
    summary = {
        "id": node.get("id"),
        "name": node.get("name"),
        "type": node.get("type"),
        "visible": node.get("visible", True),
    }

    bbox = node.get("absoluteBoundingBox")
    if bbox:
        summary["bounds"] = {
            "width": bbox.get("width"),
            "height": bbox.get("height"),
            "x": bbox.get("x"),
            "y": bbox.get("y")
        }

    # Layout & Auto Layout
    layout_mode = node.get("layoutMode")
    if layout_mode:
        summary["layout"] = {
            "mode": layout_mode,
            "itemSpacing": node.get("itemSpacing"),
            "paddingTop": node.get("paddingTop"),
            "paddingRight": node.get("paddingRight"),
            "paddingBottom": node.get("paddingBottom"),
            "paddingLeft": node.get("paddingLeft"),
            "primaryAxisAlign": node.get("primaryAxisAlignItems"),
            "counterAxisAlign": node.get("counterAxisAlignItems")
        }

    # Text content & typography
    if node.get("type") == "TEXT":
        summary["characters"] = node.get("characters")
        style = node.get("style", {})
        summary["typography"] = {
            "fontFamily": style.get("fontFamily"),
            "fontWeight": style.get("fontWeight"),
            "fontSize": style.get("fontSize"),
            "lineHeightPx": style.get("lineHeightPx"),
            "textAlignHorizontal": style.get("textAlignHorizontal")
        }

    # Fills / Colors
    fills = node.get("fills", [])
    if fills:
        colors = []
        for fill in fills:
            if fill.get("type") == "SOLID" and "color" in fill:
                c = fill["color"]
                opacity = fill.get("opacity", c.get("a", 1))
                r = int(c.get("r", 0) * 255)
                g = int(c.get("g", 0) * 255)
                b = int(c.get("b", 0) * 255)
                colors.append(f"rgba({r}, {g}, {b}, {opacity:.2f})")
        if colors:
            summary["colors"] = colors

    # Children
    children = node.get("children", [])
    if children:
        summary["children"] = [extract_node_summary(c, styles_map) for c in children]

    return summary

def generate_markdown_spec(node_summary, image_rel_path=None):
    lines = []
    lines.append(f"# Figma Spec: {node_summary.get('name')} (`{node_summary.get('id')}`)")
    lines.append("")
    if image_rel_path:
        lines.append(f"![Preview]({image_rel_path})")
        lines.append("")

    bounds = node_summary.get("bounds", {})
    lines.append("## 1. Thông số kích thước")
    lines.append(f"- **Type:** `{node_summary.get('type')}`")
    lines.append(f"- **Kích thước:** `{bounds.get('width', 0)}px` (W) × `{bounds.get('height', 0)}px` (H)")
    lines.append(f"- **Tọa độ canvas:** `(x: {bounds.get('x', 0)}, y: {bounds.get('y', 0)})`")
    lines.append("")

    # Extract all text elements
    texts = []
    def collect_texts(item):
        if item.get("type") == "TEXT" and item.get("characters"):
            typo = item.get("typography", {})
            texts.append({
                "text": item.get("characters"),
                "font": f"{typo.get('fontFamily')} {typo.get('fontWeight')} {typo.get('fontSize')}px",
                "color": item.get("colors", ["N/A"])[0] if item.get("colors") else "N/A"
            })
        for ch in item.get("children", []):
            collect_texts(ch)

    collect_texts(node_summary)

    if texts:
        lines.append("## 2. Danh sách nội dung Text & Typography")
        lines.append("| Text | Font & Size | Color |")
        lines.append("| :--- | :--- | :--- |")
        for t in texts:
            safe_text = t["text"].replace("\n", " ").replace("|", "\\|")
            lines.append(f"| {safe_text} | {t['font']} | `{t['color']}` |")
        lines.append("")

    # Children components
    lines.append("## 3. Cấu trúc Component / Children")
    for ch in node_summary.get("children", []):
        ch_bounds = ch.get("bounds", {})
        lines.append(f"- **{ch.get('name')}** (`{ch.get('type')}`): `{ch_bounds.get('width', 0)} × {ch_bounds.get('height', 0)}px`")
    lines.append("")

    return "\n".join(lines)

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 inspect_figma.py <FIGMA_URL_OR_FILE_KEY> [NODE_ID] [--scale 2]")
        sys.exit(1)

    raw_input = sys.argv[1]
    file_key, node_id_from_url = parse_figma_url(raw_input)

    node_id = sys.argv[2] if len(sys.argv) > 2 and not sys.argv[2].startswith("--") else node_id_from_url
    if node_id:
        node_id = node_id.replace("-", ":")

    scale = 2
    if "--scale" in sys.argv:
        idx = sys.argv.index("--scale")
        if idx + 1 < len(sys.argv):
            scale = int(sys.argv[idx + 1])

    env = load_env(ENV_PATH)
    token = env.get("FIGMA_API_KEY")
    if not token:
        print(f"Error: FIGMA_API_KEY not found in {ENV_PATH}")
        sys.exit(1)

    print(f"🚀 File Key: {file_key}")
    if node_id:
        print(f"🎯 Target Node ID: {node_id}")

    screenshots_dir = BASE_DIR / "screenshots"
    specs_dir = BASE_DIR / "specs"
    screenshots_dir.mkdir(parents=True, exist_ok=True)
    specs_dir.mkdir(parents=True, exist_ok=True)

    if node_id:
        # 1. Fetch Node Detail
        print("📥 Đang lấy dữ liệu chi tiết của node...")
        endpoint = f"files/{file_key}/nodes?ids={urllib.parse.quote(node_id)}"
        data = fetch_figma_api(endpoint, token)
        nodes_dict = data.get("nodes", {})
        if node_id not in nodes_dict:
            print(f"❌ Không tìm thấy node {node_id} trong file!")
            sys.exit(1)

        document = nodes_dict[node_id]["document"]
        node_name = document.get("name", "frame")
        clean_name = sanitize_filename(f"{node_name}_{node_id.replace(':', '_')}")

        # 2. Fetch rendered Image
        print(f"📸 Đang yêu cầu Figma render screenshot (Scale {scale}x)...")
        img_endpoint = f"images/{file_key}?ids={urllib.parse.quote(node_id)}&format=png&scale={scale}"
        img_data = fetch_figma_api(img_endpoint, token)
        img_url = img_data.get("images", {}).get(node_id)

        img_file_path = None
        if img_url:
            img_file_path = screenshots_dir / f"{clean_name}.png"
            print(f"💾 Đang tải screenshot về: {img_file_path}")
            download_image(img_url, img_file_path)
            print("✅ Đã tải xong screenshot!")
        else:
            print("⚠️ Không lấy được URL ảnh từ Figma server.")

        # 3. Extract Summary & Specs
        summary = extract_node_summary(document)
        json_spec_path = specs_dir / f"{clean_name}.json"
        with open(json_spec_path, "w", encoding="utf-8") as f:
            json.dump(summary, f, indent=2, ensure_ascii=False)

        md_spec_path = specs_dir / f"{clean_name}.md"
        rel_img = f"../screenshots/{clean_name}.png" if img_file_path else None
        md_content = generate_markdown_spec(summary, rel_img)
        with open(md_spec_path, "w", encoding="utf-8") as f:
            f.write(md_content)

        print("\n🎉 HOÀN TẤT:")
        print(f"1. Screenshot: {img_file_path}")
        print(f"2. Markdown Spec: {md_spec_path}")
        print(f"3. JSON Data: {json_spec_path}")

    else:
        # Entire file overview
        print("📥 Đang lấy thông tin tổng quan của toàn bộ file...")
        data = fetch_figma_api(f"files/{file_key}?depth=2", token)
        file_name = data.get("name")
        pages = data.get("document", {}).get("children", [])
        print(f"\n📂 Tên file: {file_name}")
        print(f"📄 Số lượng pages: {len(pages)}")
        for p in pages:
            frames = p.get("children", [])
            print(f"  • Page '{p.get('name')}': {len(frames)} top-level frames")
            for f in frames[:10]:
                print(f"    - Frame: {f.get('name')} (node-id: {f.get('id')})")
            if len(frames) > 10:
                print(f"    - ... và {len(frames) - 10} frames khác.")

if __name__ == "__main__":
    main()
