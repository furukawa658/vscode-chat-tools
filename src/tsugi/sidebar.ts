export interface SessionOption {
  id: string;
  title: string;
  requestCount: number;
  mtimeMs: number;
  usagePercent?: number;
}

export interface SidebarRenderOptions {
  language: string;
  credits: number;
  mode: string;
  autoOpen: boolean;
  sessionOptions: SessionOption[];
  selectedSessionId?: string;
  nonce: string;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char] ?? char);
}

function styles(): string {
  return `body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);font-size:13px;padding:10px}main{display:flex;flex-direction:column;gap:14px}.head{display:flex;align-items:center;justify-content:space-between;gap:12px}h1{font-size:15px;margin:0}.lang{display:flex;gap:2px}.lang button{border:1px solid var(--vscode-button-border,transparent);background:var(--vscode-input-background);color:var(--vscode-foreground);padding:4px 6px}.lang button.active{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}label{display:flex;flex-direction:column;gap:5px}input[type=number],select{box-sizing:border-box;width:100%;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,var(--vscode-widget-border));padding:7px}.check{flex-direction:row;align-items:center}.check input{margin:0}.primary{border:1px solid var(--vscode-button-border,transparent);background:var(--vscode-button-background);color:var(--vscode-button-foreground);padding:9px 10px;line-height:1.35}.primary:disabled,select:disabled{opacity:.55}.note{color:var(--vscode-descriptionForeground);font-size:11px;line-height:1.45;margin:0}button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:2px}`;
}

export function renderSidebarHtml(options: SidebarRenderOptions): string {
  const { language, credits, mode, autoOpen, sessionOptions, selectedSessionId, nonce } = options;
  const ja = language === "ja";
  const selectedId = selectedSessionId ?? sessionOptions[0]?.id;
  const t = ja
    ? { title: "次のチャット", source: "引き継ぐチャット", noSession: "利用できるチャットがありません", credits: "クレジット予算", mode: "引継ぎ内容", summaryOnly: "要約のみ", summaryDecisions: "要約＋判断事項", full: "すべて含める", auto: "新チャットを自動で開く", handoff: "選んだチャットを新チャットへ引き継ぐ", note: "選んだチャットだけを引き継ぎます。予算は課金上限ではありません。" }
    : { title: "Next Chat", source: "Chat to hand off", noSession: "No chats available", credits: "Credit budget", mode: "Handoff content", summaryOnly: "Summary only", summaryDecisions: "Summary and decisions", full: "Include all context", auto: "Open a new chat automatically", handoff: "Hand off the selected chat", note: "Only the selected chat is handed off. The budget does not enforce a billing limit." };
  const renderedSessionOptions = sessionOptions.length
    ? sessionOptions.map((option) => {
      const usage = option.usagePercent === undefined ? "" : ` · ${option.usagePercent}%`;
      const updated = new Intl.DateTimeFormat(ja ? "ja-JP" : "en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(option.mtimeMs));
      const label = `${option.title}${usage} · ${option.requestCount} ${ja ? "往復" : "exchanges"} · ${updated}`;
      return `<option value="${escapeHtml(option.id)}" ${option.id === selectedId ? "selected" : ""}>${escapeHtml(label)}</option>`;
    }).join("")
    : `<option>${t.noSession}</option>`;
  return `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'"><style nonce="${nonce}">${styles()}</style></head><body>
      <main><div class="head"><h1>${t.title}</h1><div class="lang" aria-label="Language"><button class="${!ja ? "active" : ""}" data-message="setLanguage" data-value="en">EN</button><button class="${ja ? "active" : ""}" data-message="setLanguage" data-value="ja">日本語</button></div></div>
      <label>${t.source}<select id="session" ${selectedId ? "" : "disabled"}>${renderedSessionOptions}</select></label>
      <label>${t.credits}<input id="credits" type="number" min="1" step="1" value="${credits}" /></label>
      <label>${t.mode}<select id="mode"><option value="summary-only" ${mode === "summary-only" ? "selected" : ""}>${t.summaryOnly}</option><option value="summary-decisions" ${mode === "summary-decisions" ? "selected" : ""}>${t.summaryDecisions}</option><option value="full" ${mode === "full" ? "selected" : ""}>${t.full}</option></select></label>
      <label class="check"><input id="auto" type="checkbox" ${autoOpen ? "checked" : ""}/><span>${t.auto}</span></label>
      <button id="handoff" class="primary" ${selectedId ? "" : "disabled"}>${t.handoff}</button><p class="note">${t.note}</p></main>
      <script nonce="${nonce}">const vscode=acquireVsCodeApi();document.querySelectorAll('[data-message]').forEach(b=>b.addEventListener('click',()=>vscode.postMessage({type:b.dataset.message,value:b.dataset.value})));document.getElementById('session').addEventListener('change',e=>vscode.postMessage({type:'selectSession',value:e.target.value}));document.getElementById('credits').addEventListener('change',e=>vscode.postMessage({type:'setCredits',value:Math.max(1,Math.round(Number(e.target.value)||20))}));document.getElementById('mode').addEventListener('change',e=>vscode.postMessage({type:'setHandoffMode',value:e.target.value}));document.getElementById('auto').addEventListener('change',e=>vscode.postMessage({type:'setAutoOpen',value:e.target.checked}));document.getElementById('handoff').addEventListener('click',()=>vscode.postMessage({type:'handoff',value:document.getElementById('session').value}));</script></body></html>`;
}
