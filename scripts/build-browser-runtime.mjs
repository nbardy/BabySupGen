import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = resolve(root, "supVM_full.ts");
const outPath = resolve(root, "public", "babysupvm-runtime.ts");

const source = await readFile(sourcePath, "utf8");
const core = source
  .replace(/^#!.*\n/, "")
  .split("// CLI\n// ===")[0]
  .replace(/^declare var process: any;\n/m, "")
  .replace(/^import fs from "node:fs";\n/m, "");

const browserApi = `
// Browser API
// ===========

export function runBabySupVm(source: string, options: any = {}) {
  const start = Date.now();
  const collapseRequested = Number(options.collapse ?? 1);
  let limit = collapseRequested === 0 ? 1 : collapseRequested;
  if (limit < 0 || !Number.isFinite(limit)) {
    limit = 1;
  }
  const book = parse_program(String(source || ""));
  const main = book.get("main");
  if (main === undefined) {
    throw new Error("missing @main definition");
  }
  const rt = runtime_new(book);
  const got = collapse(rt, Sterm(Ref("main"), new Map()), limit);
  const valueText = got === null ? null : show_norm(got);
  const stdout = valueText === null ? "" : valueText + " #" + rt.itrs + "\\n- Itrs: " + rt.itrs + " interactions\\n";
  return {
    ok: true,
    code: 0,
    signal: null,
    timedOut: false,
    stdout,
    stderr: "",
    valueText,
    interactions: rt.itrs,
    elapsedMs: Date.now() - start,
    collapseRequested,
    error: null,
    runtime: "browser-worker",
  };
}

export const babySupVmRuntime = Object.freeze({
  run: runBabySupVm,
});
`;

await writeFile(outPath, `${core}${browserApi}`, "utf8");
console.log(`wrote ${outPath}`);
