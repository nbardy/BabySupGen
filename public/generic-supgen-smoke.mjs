import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { genericSupGenPresets } from "./generic-supgen-presets.js";
import { parseTinySpec } from "./tiny-supgen.js";

const here = dirname(fileURLToPath(import.meta.url));
const builderPath = resolve(here, "supgen-generic-search.js");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function validateSearch(name, search) {
  assert(search && typeof search === "object", `${name}: builder returned no search object`);
  assert(typeof search.program === "string" && search.program.includes("@main"), `${name}: missing SupVM program`);
  assert(Array.isArray(search.choices) && search.choices.length > 0, `${name}: missing correlated choices`);
  assert(
    search.mode === "choiceVector" || typeof search.decodeChoiceVector === "function",
    `${name}: missing choice-vector decode contract`,
  );
}

if (!existsSync(builderPath)) {
  console.log("generic-supgen smoke skipped: public/supgen-generic-search.js is not present yet.");
  process.exit(0);
}

const { buildGenericSupGenSearch } = await import(pathToFileURL(builderPath).href);
assert(typeof buildGenericSupGenSearch === "function", "buildGenericSupGenSearch export is missing");

for (const [name, preset] of Object.entries(genericSupGenPresets)) {
  const spec = parseTinySpec(preset.spec);
  const search = buildGenericSupGenSearch(spec, { depth: preset.depth });
  validateSearch(name, search);
}

console.log(`generic-supgen smoke passed for ${Object.keys(genericSupGenPresets).length} presets.`);
