import { build } from "esbuild";
for (const [dir, src] of [["tsugi", "tsugi"], ["eien", "eien"], ["ne-memory", "ne"]]) {
  await build({ entryPoints: [`src/${src}/extension.ts`], bundle: true, platform: "node", format: "cjs", external: ["vscode"], outfile: `extensions/${dir}/dist/extension.js`, minify: true });
  console.log(`built ${dir}`);
}
