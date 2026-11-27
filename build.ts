import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { buildZig } from "./scripts/build-zig";

buildZig();
for (const [dir, src] of [["tsugi", "tsugi"], ["eien", "eien"], ["ne-memory", "ne"], ["makaseru", "makaseru"]]) {
  await build({ entryPoints: [`src/${src}/extension.ts`], bundle: true, platform: "node", format: "cjs", external: ["vscode"], outfile: `extensions/${dir}/dist/extension.js`, minify: true });
  console.log(`built ${dir}`);
}

const makaseruDist = join("extensions", "makaseru", "dist");
mkdirSync(makaseruDist, { recursive: true });
await build({ entryPoints: ["src/makaseru/server.ts"], bundle: true, platform: "node", format: "cjs", outfile: join(makaseruDist, "mcp-server.js"), minify: true });
copyFileSync(join("node_modules", "sql.js", "dist", "sql-wasm.wasm"), join(makaseruDist, "sql-wasm.wasm"));
console.log("built makaseru server");
