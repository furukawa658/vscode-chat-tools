import json, re
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(r"C:\Kanko-AX-Foundation\vscode-chat-tools\extensions")
items = {"tsugi": ("T", "#2563eb"), "eien": ("E", "#7c3aed"), "ne-memory": ("N", "#059669"), "pack": ("+", "#475569")}
font = ImageFont.truetype(r"C:\Windows\Fonts\arialbd.ttf", 150)
for name, (ch, color) in items.items():
    im = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((8, 8, 248, 248), radius=48, fill=color)
    d.text((128, 128), ch, font=font, fill="white", anchor="mm")
    im.save(root / name / "icon.png")
    p = root / name / "package.json"
    t = p.read_text(encoding="utf-8")
    j = json.loads(t)
    j["icon"] = "icon.png"
    j["version"] = "0.1.1"
    p.write_text(json.dumps(j, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(name, "ok")
