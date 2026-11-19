import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const root = join(import.meta.dir, "..");
const tempRoot = join(root, "tmp-demo-media");
const width = 1280;
const height = 720;

const escapeXml = (value: string) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");
const rect = (x: number, y: number, w: number, h: number, fill: string, radius = 0, stroke = "none") =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}" stroke="${stroke}"/>`;
const label = (x: number, y: number, value: string, size = 24, fill = "#d4d4d4", weight = 400) =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-weight="${weight}">${escapeXml(value)}</text>`;
const line = (x1: number, y1: number, x2: number, y2: number, color: string, thickness = 2) =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${thickness}"/>`;

function shell(accent: string, step: string, body: string, status: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" font-family="Segoe UI, Arial, sans-serif">
    ${rect(0, 0, width, height, "#111827")}
    ${rect(0, 0, width, 34, "#202124")}
    ${rect(0, 34, 58, height - 66, "#18181b")}
    ${rect(58, 34, 280, height - 66, "#1f2937")}
    ${rect(338, 34, width - 338, 42, "#111827")}
    ${rect(338, 76, width - 338, 612, "#1e1e1e")}
    ${label(22, 23, "VS", 14, "#7dd3fc", 700)}
    ${label(78, 23, "demo-workspace", 15, "#d1d5db")}
    ${label(78, 66, "EXPLORER", 13, "#9ca3af", 700)}
    ${label(78, 103, "src", 18, "#e5e7eb")}
    ${label(95, 134, "service.ts", 17, "#93c5fd")}
    ${label(95, 166, "rules.ts", 17, "#c4b5fd")}
    ${label(95, 198, "README.md", 17, "#86efac")}
    ${label(362, 62, step, 14, accent, 700)}
    ${body}
    ${rect(0, height - 32, width, 32, accent)}
    ${label(18, height - 10, status, 16, "#ffffff", 600)}
    ${label(1120, height - 10, "VS Code 1.147", 14, "#ffffff")}
  </svg>`;
}

const palette = (accent: string, command: string) =>
  rect(470, 112, 650, 76, "#252526", 7, "#454545") +
  rect(486, 131, 30, 38, accent, 4) +
  label(497, 157, ">", 22, "#ffffff", 700) +
  label(535, 153, command, 21, "#ffffff", 600) +
  label(536, 174, "Press Enter", 13, "#9ca3af");

const frames: Record<string, string[]> = {
  tsugi: [
    shell("#2563eb", "1 / 3  CONTEXT USAGE", `
      ${label(390, 130, "Long Copilot chat", 28, "#f9fafb", 700)}
      ${label(390, 172, "Tsugi reads the latest chat save file and calculates context usage.", 17, "#9ca3af")}
      ${rect(390, 230, 760, 220, "#252526", 8, "#3f3f46")}
      ${label(430, 285, "Current context", 19, "#d4d4d4", 600)}
      ${rect(430, 318, 620, 28, "#374151", 5)}
      ${rect(430, 318, 527, 28, "#f59e0b", 5)}
      ${label(430, 390, "170,000 / 200,000 tokens", 30, "#fbbf24", 700)}
      ${rect(915, 370, 170, 48, "#92400e", 6)}
      ${label(1000, 401, "85%", 23, "#ffffff", 700)}
      ${label(390, 508, "Warning: hand off before the next long response.", 18, "#d1d5db")}
    `, "Tsugi 85% - click to hand off"),
    shell("#2563eb", "2 / 3  ONE-CLICK HANDOFF", `
      ${label(390, 110, "Command Palette", 24, "#f9fafb", 700)}
      ${palette("#2563eb", "Tsugi: Hand Off to a New Chat")}
      ${rect(470, 222, 650, 210, "#252526", 8, "#3f3f46")}
      ${label(500, 265, "Handoff includes", 20, "#d4d4d4", 600)}
      ${label(500, 310, "1. Original request", 19, "#93c5fd")}
      ${label(500, 349, "2. Recent exchanges", 19, "#93c5fd")}
      ${label(500, 388, "3. Git state for every workspace folder", 19, "#93c5fd")}
    `, "Tsugi creates a local handoff prompt - nothing is submitted"),
    shell("#2563eb", "3 / 3  REVIEW AND SEND", `
      ${label(390, 120, "Fresh Copilot Chat", 27, "#f9fafb", 700)}
      ${rect(390, 160, 820, 350, "#202124", 9, "#3f3f46")}
      ${label(425, 210, "# Handoff from the previous chat", 22, "#bfdbfe", 700)}
      ${label(425, 254, "Goal: finish the extension package and verify it.", 18, "#d4d4d4")}
      ${label(425, 293, "Current state: build and tests pass.", 18, "#d4d4d4")}
      ${label(425, 332, "Git state: 4 extension manifests changed.", 18, "#d4d4d4")}
      ${label(425, 374, "Next: review the prompt, then continue in the new chat.", 18, "#d4d4d4")}
      ${rect(425, 425, 720, 58, "#111827", 7, "#2563eb")}
      ${label(448, 462, "Review, edit, and send when ready", 19, "#93c5fd", 600)}
    `, "New chat is ready - you stay in control"),
  ],
  eien: [
    shell("#f97316", "1 / 3  START NIGHT MONITORING", `
      ${label(390, 110, "Command Palette", 24, "#f9fafb", 700)}
      ${palette("#f97316", "Eien: Start Overnight Monitoring")}
      ${rect(470, 222, 650, 215, "#252526", 8, "#3f3f46")}
      ${label(500, 270, "Limits", 20, "#d4d4d4", 600)}
      ${label(500, 315, "Idle before resume: 120 seconds", 19, "#fdba74")}
      ${label(500, 355, "Maximum runtime: 8 hours", 19, "#fdba74")}
      ${label(500, 395, "Maximum interventions: 20", 19, "#fdba74")}
    `, "Eien monitoring active"),
    shell("#f97316", "2 / 3  CHECKPOINT AND RESUME", `
      ${label(390, 120, "Overnight timeline", 27, "#f9fafb", 700)}
      ${line(430, 300, 1150, 300, "#64748b", 5)}
      ${[150, 390, 630, 870].map((x, i) => {
        const markerX = 430 + x * 0.7;
        return `${rect(markerX, 278, 44, 44, i === 3 ? "#dc2626" : "#f97316", 22)}${label(markerX + 22, 342, ["22:00", "01:30", "04:10", "07:00"][i], 18, "#f9fafb", 700)}${label(markerX + 22, 385, ["Start", "Resume", "Resume", "Stop"][i], 17, "#fdba74")}`;
      }).join("")}
      ${rect(390, 448, 790, 88, "#431407", 8, "#f97316")}
      ${label(420, 485, "Idle chat detected while processing. Continue prompt sent.", 20, "#ffedd5", 600)}
      ${label(420, 516, "Working tree saved to refs/eien/checkpoint.", 18, "#fdba74")}
    `, "Checkpoint saved - work branch unchanged"),
    shell("#f97316", "3 / 3  MORNING REPORT", `
      ${label(390, 120, "morning-report.md", 27, "#f9fafb", 700)}
      ${rect(390, 160, 820, 360, "#202124", 9, "#3f3f46")}
      ${label(425, 210, "# Eien morning report", 22, "#fed7aa", 700)}
      ${label(425, 258, "- 22:00 Started overnight monitoring", 18, "#d4d4d4")}
      ${label(425, 297, "- 01:30 Idle while processing; continue prompt sent", 18, "#d4d4d4")}
      ${label(425, 336, "- 01:30 Checkpoint saved to refs/eien/checkpoint", 18, "#d4d4d4")}
      ${label(425, 375, "- 07:00 Stopped after reaching the time limit", 18, "#d4d4d4")}
      ${label(425, 426, "No commit was added to your working branch.", 19, "#fb923c", 600)}
    `, "Morning report ready - review checkpoints before continuing"),
  ],
  ne: [
    shell("#7c3aed", "1 / 3  MEASURE CORRECTIONS", `
      ${label(390, 110, "Command Palette", 24, "#f9fafb", 700)}
      ${palette("#7c3aed", "Ne: Measure Repeated Corrections")}
      ${rect(470, 222, 650, 215, "#252526", 8, "#3f3f46")}
      ${label(500, 270, "Last 20 chats", 20, "#d4d4d4", 600)}
      ${label(500, 320, "84 messages checked", 19, "#c4b5fd")}
      ${label(500, 360, "12 repeated corrections found", 26, "#a78bfa", 700)}
      ${label(500, 400, "No language model used for measurement.", 17, "#9ca3af")}
    `, "Ne found 12 repeated corrections"),
    shell("#7c3aed", "2 / 3  APPROVE A RULE", `
      ${label(390, 110, "Five-second review window", 27, "#f9fafb", 700)}
      ${rect(470, 150, 650, 330, "#252526", 10, "#6d28d9")}
      ${label(505, 205, "Ne found a reusable rule", 24, "#ffffff", 700)}
      ${rect(505, 238, 575, 110, "#18181b", 7, "#3f3f46")}
      ${label(530, 285, "Use tabs for indentation in TypeScript files.", 21, "#ddd6fe", 600)}
      ${label(530, 320, "Automatic registration in 5 seconds.", 19, "#c4b5fd")}
      ${rect(505, 382, 340, 52, "#7c3aed", 7)}
      ${label(675, 416, "Review, edit, register", 17, "#ffffff", 700)}
      ${rect(865, 382, 150, 52, "#3f3f46", 7)}
      ${label(940, 416, "Ignore", 19, "#e5e7eb", 700)}
    `, "Only approved rules are saved"),
    shell("#7c3aed", "3 / 3  USER MEMORY", `
      ${label(390, 120, "ne-rules.md", 27, "#f9fafb", 700)}
      ${rect(390, 160, 820, 360, "#202124", 9, "#3f3f46")}
      ${label(425, 210, "# Rules registered by Ne", 22, "#ddd6fe", 700)}
      ${label(425, 260, "- Use tabs for indentation in TypeScript files.", 20, "#d4d4d4")}
      ${label(425, 305, "- Do not modify unrelated formatting.", 20, "#d4d4d4")}
      ${label(425, 360, "Stored in Copilot user memory", 18, "#a78bfa", 600)}
      ${label(425, 399, "Workspace instruction files were not changed.", 18, "#d4d4d4")}
      ${label(425, 438, "Undo is available from Ne registration history.", 18, "#d4d4d4")}
    `, "Rule saved to Copilot user memory"),
  ],
};

rmSync(tempRoot, { recursive: true, force: true });
mkdirSync(tempRoot, { recursive: true });

for (const [name, framesForExtension] of Object.entries(frames)) {
  const extensionDir = name === "ne" ? "ne-memory" : name;
  const outputDir = join(root, "extensions", extensionDir, "images");
  const frameDir = join(tempRoot, name);
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(frameDir, { recursive: true });

  framesForExtension.forEach((svg, index) => {
    const svgPath = join(frameDir, `frame-${index}.svg`);
    const pngPath = join(frameDir, `frame-${index}.png`);
    writeFileSync(svgPath, svg, "utf8");
    const result = spawnSync(chrome, [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      `--window-size=${width},${height}`,
      `--screenshot=${pngPath}`,
      `file:///${svgPath.replaceAll("\\", "/")}`,
    ], { env: { ...process.env, HTTP_PROXY: "", HTTPS_PROXY: "", http_proxy: "", https_proxy: "" } });
    if (result.status !== 0) {
      throw new Error(`${name} frame ${index} failed: ${result.stderr.toString()}`);
    }
  });

  copyFileSync(join(frameDir, "frame-1.png"), join(outputDir, "demo.png"));
  const videoResult = spawnSync("python", [join(root, "scripts", "render-demo-video.py"), frameDir, join(outputDir, "demo.mp4")], { stdio: "inherit" });
  if (videoResult.status !== 0) {
    throw new Error(`${name} video rendering failed`);
  }
  console.log(`${name}: wrote demo.png and demo.mp4`);
}

rmSync(tempRoot, { recursive: true, force: true });
