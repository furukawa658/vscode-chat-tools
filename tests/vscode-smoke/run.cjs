const { mkdirSync, rmSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { runTests } = require("@vscode/test-electron");

delete process.env.ELECTRON_RUN_AS_NODE;

const targets = process.argv.slice(2);
const selected = targets.length ? targets : ["tsugi", "eien", "ne-memory"];
const root = resolve(__dirname, "../..");
const executable = process.env.VSCODE_EXECUTABLE || join(process.env.LOCALAPPDATA, "Programs", "Microsoft VS Code", "Code.exe");

async function main() {
  for (const target of selected) {
    const extensionDevelopmentPath = join(root, "extensions", target);
    const runRoot = join(root, "tmp", "vscode-smoke", target);
    const userDataDir = join(runRoot, "user-data");
    const workspacePath = join(runRoot, "workspace");
    const extensionsDir = join(runRoot, "extensions");
    rmSync(runRoot, { recursive: true, force: true });
    mkdirSync(workspacePath, { recursive: true });
    mkdirSync(extensionsDir, { recursive: true });

    process.env.SMOKE_TARGET = target;
    process.env.SMOKE_USER_DATA_DIR = userDataDir;
    console.log(`Testing ${target} in VS Code Extension Host`);
    await runTests({
      vscodeExecutablePath: executable,
      extensionDevelopmentPath,
      extensionTestsPath: join(__dirname, "index.cjs"),
      launchArgs: [
        workspacePath,
        "--disable-workspace-trust",
        "--skip-welcome",
        "--skip-release-notes",
        `--user-data-dir=${userDataDir}`,
        `--extensions-dir=${extensionsDir}`,
      ],
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
