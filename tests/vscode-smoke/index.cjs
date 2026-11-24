const assert = require("node:assert/strict");
const { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const vscode = require("vscode");

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function workspaceStorageFolders(userDataDir) {
  const root = join(userDataDir, "User", "workspaceStorage");
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name));
}

function sessionFixture(id, firstRequest, correction) {
  return JSON.stringify({
    kind: 0,
    v: {
      sessionId: id,
      requests: [
        {
          requestId: `${id}-1`,
          timestamp: Date.now() - 2000,
          message: { text: firstRequest },
          response: [{ kind: "markdownContent", value: "作業を開始した。" }],
          promptTokens: 100,
          completionTokens: 20,
          modelId: "copilot/example",
          modelConfiguration: { contextSize: 200000 },
          modelState: { value: 1 },
        },
        {
          requestId: `${id}-2`,
          timestamp: Date.now() - 1000,
          message: { text: correction },
          response: [{ kind: "markdownContent", value: "修正した。" }],
          promptTokens: 200,
          completionTokens: 20,
          modelId: "copilot/example",
          modelConfiguration: { contextSize: 200000 },
          modelState: { value: 1 },
        },
      ],
      inputState: { mode: { kind: "agent" } },
    },
  });
}

async function installSessionFixtures(userDataDir) {
  const folders = workspaceStorageFolders(userDataDir);
  assert.ok(folders.length > 0, "workspace storage folder was not created");
  const folder = folders.sort((left, right) => right.localeCompare(left))[0];
  const chatSessions = join(folder, "chatSessions");
  mkdirSync(chatSessions, { recursive: true });
  writeFileSync(join(chatSessions, "one.jsonl"), sessionFixture("one", "チャットA: 認証画面を完成させる", "勝手に消さないで"), "utf8");
  writeFileSync(join(chatSessions, "two.jsonl"), sessionFixture("two", "チャットB: 帳票出力だけ直す", "この画面は変更しないで"), "utf8");
}

function storageFiles(root, prefix) {
  if (!existsSync(root)) return [];
  return readdirSync(root).filter((name) => name.startsWith(prefix)).map((name) => join(root, name));
}

async function run() {
  const target = process.env.SMOKE_TARGET;
  const userDataDir = process.env.SMOKE_USER_DATA_DIR;
  assert.ok(target, "SMOKE_TARGET is required");
  assert.ok(userDataDir, "SMOKE_USER_DATA_DIR is required");

  const definitions = {
    tsugi: { id: "ShunsukeF.tsugi", commands: ["tsugi.handoff", "tsugi.split"] },
    eien: { id: "ShunsukeF.eien", commands: ["eien.start", "eien.stop", "eien.report"] },
    "ne-memory": { id: "ShunsukeF.ne-memory", commands: ["ne.measure", "ne.analyze", "ne.undo"] },
  };
  const definition = definitions[target];
  assert.ok(definition, `unknown target: ${target}`);

  const extension = vscode.extensions.getExtension(definition.id);
  assert.ok(extension, `${definition.id} was not discovered`);
  await extension.activate();
  const commands = await vscode.commands.getCommands(true);
  for (const command of definition.commands) assert.ok(commands.includes(command), `${command} was not registered`);

  await delay(500);
  await installSessionFixtures(userDataDir);

  if (target === "tsugi") {
    await vscode.commands.executeCommand("tsugi.handoff", "one");
    const globalStorage = join(userDataDir, "User", "globalStorage", definition.id);
    const files = storageFiles(globalStorage, "handoff-");
    assert.ok(files.length > 0, "Tsugi did not save a handoff file");
    const handoff = readFileSync(files[0], "utf8");
    assert.match(handoff, /チャットA: 認証画面を完成させる/);
    assert.doesNotMatch(handoff, /チャットB: 帳票出力だけ直す/);
  } else if (target === "eien") {
    await vscode.commands.executeCommand("eien.report");
    const document = vscode.window.activeTextEditor?.document;
    assert.equal(document?.fileName.split(/[\\/]/).at(-1), "morning-report.md");
  } else {
    await vscode.commands.executeCommand("ne.measure");
  }
}

module.exports = { run };
