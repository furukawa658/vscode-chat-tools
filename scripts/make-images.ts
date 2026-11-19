import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const root = join(import.meta.dir, "..");
const W = 1200;
const H = 520;

const box = (x: number, y: number, w: number, h: number, fill: string, stroke = "none") =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
const text = (x: number, y: number, s: string, size = 26, fill = "#1f2937", weight = 400, anchor = "start") =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-weight="${weight}" text-anchor="${anchor}">${s}</text>`;
const arrow = (x1: number, y1: number, x2: number, y2: number, c: string) =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="5"/><polygon points="${x2},${y2} ${x2 - 16},${y2 - 11} ${x2 - 16},${y2 + 11}" fill="${c}"/>`;

const frame = (accent: string, title: string, sub: string, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="Segoe UI, Arial, sans-serif">
<rect width="${W}" height="${H}" fill="#f8fafc"/><rect width="${W}" height="10" fill="${accent}"/>
${text(60, 85, title, 44, "#111827", 700)}${text(60, 130, sub, 26, "#4b5563")}${body}</svg>`;

const images: Record<string, string> = {
  tsugi: frame("#2563eb", "Tsugi", "Hand off a long chat to a fresh one in one click",
    box(60, 190, 300, 250, "#ffffff", "#cbd5e1") + text(90, 245, "Chat is getting long", 26, "#111827", 600) +
    box(90, 275, 240, 22, "#e5e7eb") + box(90, 275, 205, 22, "#f59e0b") + text(90, 335, "Context: 85%", 28, "#b45309", 700) +
    text(90, 380, "Status bar warns you", 22, "#4b5563") +
    arrow(380, 315, 470, 315, "#2563eb") +
    box(480, 190, 300, 250, "#dbeafe", "#2563eb") + text(510, 245, "Click the status bar", 26, "#1e3a8a", 600) +
    text(510, 290, "1. First request", 22, "#1e3a8a") + text(510, 325, "2. Recent exchanges", 22, "#1e3a8a") + text(510, 360, "3. Git state", 22, "#1e3a8a") +
    arrow(800, 315, 890, 315, "#2563eb") +
    box(900, 190, 240, 250, "#ffffff", "#2563eb") + text(930, 245, "New chat", 26, "#111827", 600) +
    text(930, 290, "Handoff is in the", 22, "#4b5563") + text(930, 320, "input box.", 22, "#4b5563") + text(930, 370, "Review, then send.", 22, "#2563eb", 600)),
  eien: frame("#f97316", "Eien", "Keep Copilot going while you sleep (example timeline)",
    `<line x1="90" y1="300" x2="1110" y2="300" stroke="#cbd5e1" stroke-width="6"/>` +
    [["22:00", "Start", "#16a34a"], ["01:30", "Idle? Nudge + checkpoint", "#f97316"], ["04:10", "Idle? Nudge + checkpoint", "#f97316"], ["07:00", "Limit reached: stop", "#dc2626"]]
      .map(([t, l, c], i) => `<circle cx="${150 + i * 300}" cy="300" r="20" fill="${c}"/>` + text(150 + i * 300, 250, t, 28, "#111827", 700, "middle") + text(150 + i * 300, 360, l, 22, "#374151", 400, "middle")).join("") +
    box(60, 410, 1080, 70, "#ffedd5", "#f97316") + text(600, 455, "Morning: open the report. Work is saved in refs/eien/checkpoint, no commits on your branch.", 24, "#9a3412", 600, "middle")),
  ne: frame("#7c3aed", "Ne", "Turn repeated corrections into rules, with your approval",
    box(60, 190, 330, 250, "#ffffff", "#cbd5e1") + text(90, 240, "Your past chats", 26, "#111827", 600) +
    text(90, 290, "\"No, not like that\"", 22, "#6d28d9") + text(90, 325, "\"I told you before\"", 22, "#6d28d9") + text(90, 360, "\"Use tabs, not spaces\"", 22, "#6d28d9") +
    arrow(410, 315, 500, 315, "#7c3aed") +
    box(510, 190, 330, 250, "#ede9fe", "#7c3aed") + text(540, 240, "Draft rule", 26, "#4c1d95", 600) +
    text(540, 290, "Use tabs for indentation", 22, "#4c1d95") + box(540, 340, 170, 60, "#7c3aed") + text(625, 380, "Approve", 26, "#ffffff", 600, "middle") +
    arrow(860, 315, 950, 315, "#7c3aed") +
    box(960, 190, 190, 250, "#ffffff", "#7c3aed") + text(990, 250, "Copilot", 26, "#111827", 600) + text(990, 290, "memory", 26, "#111827", 600) +
    text(990, 345, "Only approved", 20, "#4b5563") + text(990, 375, "rules are saved", 20, "#4b5563")),
};

const tmp = join(root, "tmp-img");
mkdirSync(tmp, { recursive: true });
for (const [name, svg] of Object.entries(images)) {
  const dir = name === "ne" ? "ne-memory" : name;
  const out = join(root, "extensions", dir, "images");
  mkdirSync(out, { recursive: true });
  const svgPath = join(tmp, `${name}.svg`);
  writeFileSync(svgPath, svg);
  const r = spawnSync(chrome, ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--window-size=${W},${H}`, `--screenshot=${join(out, "overview.png")}`, `file:///${svgPath.replaceAll("\\", "/")}`], { env: { ...process.env, HTTP_PROXY: "", HTTPS_PROXY: "", http_proxy: "", https_proxy: "" } });
  if (r.status !== 0) { console.error(`${name}: chrome failed (${r.status})`); process.exit(1); }
  console.log(`${name}: wrote ${join(out, "overview.png")}`);
}
rmSync(tmp, { recursive: true, force: true });
