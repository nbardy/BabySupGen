import { buildTinySearch, parseTinyCandidateId, tinyPresets } from "./tiny-supgen.js";
import { runCompiledSearch } from "./compiled-search-runtime.js";
import { buildFastSearchIR } from "./fast-search-ir.js";
import { genericSearchDialects } from "./supgen-generic-search.js";
import {
  Ctx,
  Source,
  Type,
  genTermDirect,
  helperTypeRecord,
  printSource,
  serializeGenerated,
  serializeHelperType,
} from "./object-language-generator-ir.js";

const examples = {
  list: `@main = [1,2,3]\n`,
  choice: `@main = &choice{[0,1];[1,0]}\n`,
  filter: `@pick = &bit{0;1}
@main = λ{0: &{}; 1: @pick}(@pick === 1)
`,
  search: `@op = &op{λx.x; λx.[x]}

@main =
  λ{0:&{}; 1:
    λ{0:&{}; 1:@op}(@op(2) === [2])
  }(@op(7) === [7])
`,
};

const source = document.querySelector("#source");
const output = document.querySelector("#output");
const collapse = document.querySelector("#collapse");
const runtimeMode = document.querySelector("#runtime-mode");
const runProgramButton = document.querySelector("#run-program");
const clear = document.querySelector("#clear");
const stats = document.querySelector("#stats");
const docs = document.querySelector("#docs");
const docTabs = document.querySelectorAll("[data-doc]");
const tinyPreset = document.querySelector("#tiny-preset");
const tinyDepth = document.querySelector("#tiny-depth");
const searchDialect = document.querySelector("#search-dialect");
const tinySpec = document.querySelector("#tiny-spec");
const tinySummary = document.querySelector("#tiny-summary");
const tinyOutput = document.querySelector("#tiny-output");
const runTiny = document.querySelector("#run-tiny");
const engineMode = document.querySelector("#engine-mode");
const engineSummary = document.querySelector("#engine-summary");
const engineDemo = document.querySelector("#engine-demo");
const previewEngine = document.querySelector("#preview-engine");
const loadEngineDemo = document.querySelector("#load-engine-demo");
const BROWSER_RUN_TIMEOUT_MS = 60_000;
let browserRunId = 0;

function setDisabled(element, disabled) {
  if (element) {
    element.disabled = disabled;
  }
}

function setExample(name) {
  source.value = examples[name] || examples.list;
  output.textContent = "";
}

function formatResult(result) {
  const parts = [];
  if (result.stdout) {
    const lines = result.stdout.trimEnd().split("\n");
    if (stats && !stats.checked) {
      parts.push(lines.filter((line) => !line.startsWith("- Itrs:")).join("\n"));
    } else {
      parts.push(result.stdout.trimEnd());
    }
  }
  if (result.stderr) {
    parts.push(result.stderr.trimEnd());
  }
  if (result.timedOut) {
    parts.push("Timed out.");
  }
  if (result.code !== 0 && result.code !== null) {
    parts.push(`Exit code: ${result.code}`);
  }
  if (result.signal) {
    parts.push(`Signal: ${result.signal}`);
  }
  return parts.filter(Boolean).join("\n\n");
}

function selectedSearchDialect() {
  return searchDialect?.value || "library";
}

function buildSortSearch(dialect = selectedSearchDialect()) {
  return buildTinySearch(tinyPresets.genericSort.spec, {
    depth: tinyPresets.genericSort.depth,
    dialect,
  });
}

function formatSortZeroVector(search = buildSortSearch()) {
  const zeroVector = search.choices.map(() => 0);
  const rows = search.choices.map((choice, index) => {
    const option = choice.items?.[0]?.source ?? choice.items?.[0]?.term ?? "unknown";
    return `${index}. ${choice.name || choice.label}: option 0 = ${option}`;
  });
  return [
    `Choice vector: [${zeroVector.join(",")}]`,
    "",
    rows.join("\n"),
    "",
    "Decoded program:",
    search.decodeChoiceVector(zeroVector),
  ].join("\n");
}

function formatFastIrDemo() {
  const search = buildSortSearch();
  const fastIR = buildFastSearchIR(search);
  const dims = fastIR.dimensions
    .map((dimension) => `${dimension.id}. ${dimension.label}: ${dimension.arity} options`)
    .join("\n");
  return [
    "FastSearchIR for the recursive integer sort preset",
    "",
    `Engine: ${fastIR.engine}`,
    `Mode: ${fastIR.mode}`,
    `Choices: ${fastIR.dimensions.length}`,
    `Candidate space: ${fastIR.candidateCountText}`,
    `Can decode choice vectors: ${fastIR.canDecodeChoiceVector ? "yes" : "no"}`,
    "",
    "Dimensions:",
    dims,
    "",
    formatSortZeroVector(search),
  ].join("\n");
}

function formatObjectGeneratorDemo() {
  const intCtx = Ctx.from([Ctx.binding("x", Type.int(), Source.var("x"))]);
  const atoms = genTermDirect(Type.int(), intCtx, {
    label: "root atom",
    intLiterals: [0, 1],
  });
  const helper = helperTypeRecord("aux", Type.fun(Type.list(Type.int()), Type.int()), {
    label: "aux type",
  });
  return [
    "Object-language generator IR sample",
    "",
    `Helper hole: ${serializeHelperType(helper)}`,
    "",
    "Generated Int atoms:",
    atoms
      .map(
        (atom, index) =>
          `${index}. source=${printSource(atom.source)} value=${atom.value}\n   ${serializeGenerated(atom)}`,
      )
      .join("\n"),
  ].join("\n");
}

const engineModes = {
  rawSupVm: {
    title: "Browser BabySupVM Runtime",
    summary: () =>
      [
        "Status: active executor",
        "",
        "Run button path:",
        "public/app.js",
        "  -> Web Worker",
        "babysupvm-worker.js",
        "  -> babysupvm-runtime.js",
        "browser runtime",
        "  -> parse, evaluate @main, collapse, return JSON",
        "",
        "server.mjs remains only as a local fallback/host.",
      ].join("\n"),
    demo: () => examples.search.trim(),
    load: () => setExample("search"),
  },
  genericSupGen: {
    title: "BabySupGen Search",
    summary: () =>
      [
        "Status: active generalized search path",
        `Dialect: ${genericSearchDialects[selectedSearchDialect()]?.label || selectedSearchDialect()}`,
        "",
        "Spec text",
        "  -> parseTinySpec",
        "  -> buildGenericSupGenSearch",
        "  -> generated search object plus BabySupVM fallback program",
        "  -> WebGPU/FastSearch when compiled metadata is available",
        "  -> Browser Worker fallback for raw BabySupVM execution",
        "  -> decode choice vector back to source",
      ].join("\n"),
    demo: () => buildSortSearch().program.slice(0, 5000),
    load: () => {
      setTinyPreset("genericSort");
      generateTinyIntoEditor();
    },
  },
  fastSearchIr: {
    title: "FastSearchIR",
    summary: () =>
      [
        "Status: active executor for generated BabySupGen searches",
        "",
        "BabySupGen search object",
        "  -> choice dimensions",
        "  -> mixed-radix candidate ids",
        "  -> compiled structural evaluator",
        "  -> surviving choice vector",
        "",
        "The WebGPU/FastSearch selector routes Run Search here when compiled variant metadata is available.",
        "Scalar direct candidate searches run through a real browser WebGPU kernel when available.",
        "Recursive structural searches currently execute as a compiled CPU plan; raw BabySupVM still uses Browser Worker.",
      ].join("\n"),
    demo: formatFastIrDemo,
    load: () => {
      setTinyPreset("genericSort");
      generateTinyIntoEditor();
      tinySummary.textContent = `${tinySummary.textContent}\n\n${formatFastIrDemo()}`;
    },
  },
  objectGeneratorIr: {
    title: "Object Generator IR",
    summary: () =>
      [
        "Status: implemented scaffold, not executing inside BabySupVM yet",
        "",
        "This is the path toward generator-in-the-object-language:",
        "Type / Ctx / Source / Generated / Path records",
        "deterministic label forking",
        "structurally-smaller recursion checks",
        "",
        "Next step is lowering gen_type/gen_term into BabySupVM terms.",
      ].join("\n"),
    demo: formatObjectGeneratorDemo,
    load: () => {
      engineDemo.textContent = formatObjectGeneratorDemo();
      source.value = [
        "// Object Generator IR currently previews in the browser.",
        "// The runnable BabySupVM demo here is just the lowered value shape.",
        "@main = [0,1]",
        "",
      ].join("\n");
      output.textContent = "";
    },
  },
};

function selectedEngineMode() {
  return engineModes[engineMode.value] || engineModes.rawSupVm;
}

function previewSelectedEngine() {
  const mode = selectedEngineMode();
  engineSummary.textContent = mode.summary();
  engineDemo.textContent = mode.demo();
}

function loadSelectedEngineDemo() {
  selectedEngineMode().load();
  previewSelectedEngine();
}

function postRunBrowser(sourceText) {
  if (typeof Worker === "undefined") {
    return null;
  }
  return new Promise((resolve) => {
    const id = ++browserRunId;
    const worker = new Worker(new URL("./babysupvm-worker.js", import.meta.url), { type: "module" });
    const started = performance.now();
    const timer = setTimeout(() => {
      worker.terminate();
      resolve({
        ok: false,
        code: null,
        signal: "WORKER_TIMEOUT",
        timedOut: true,
        stdout: "",
        stderr: "browser worker timed out\n",
        valueText: null,
        interactions: null,
        elapsedMs: Math.round(performance.now() - started),
        collapseRequested: Number(collapse?.value) || 1,
        error: "browser worker timed out",
        runtime: "browser-worker",
      });
    }, BROWSER_RUN_TIMEOUT_MS);
    worker.onmessage = (event) => {
      if (event.data?.id !== id) {
        return;
      }
      clearTimeout(timer);
      worker.terminate();
      resolve(event.data.result);
    };
    worker.onerror = (event) => {
      clearTimeout(timer);
      worker.terminate();
      resolve({
        ok: false,
        code: 1,
        signal: null,
        timedOut: false,
        stdout: "",
        stderr: `${event.message || "browser worker failed"}\n`,
        valueText: null,
        interactions: null,
        elapsedMs: Math.round(performance.now() - started),
        collapseRequested: Number(collapse?.value) || 1,
        error: event.message || "browser worker failed",
        runtime: "browser-worker",
      });
    };
    worker.postMessage({ id, source: sourceText, collapse: collapse?.value || 1 });
  });
}

function postRunWebGpuRawUnsupported() {
  return {
    ok: false,
    code: 1,
    signal: null,
    timedOut: false,
    stdout: "",
    stderr:
      "WebGPU/FastSearch runs generated BabySupGen searches from Run Search.\nScalar direct candidates can use the browser WebGPU kernel; recursive structural searches use the compiled CPU plan.\nRaw BabySupVM programs still run through Browser Worker or Server Fallback.\n",
    valueText: null,
    interactions: null,
    elapsedMs: 0,
    collapseRequested: Number(collapse?.value) || 1,
    error: "WebGPU/FastSearch does not run raw BabySupVM source",
    runtime: "fastsearch-raw-unsupported",
  };
}

async function postRunServer(sourceText) {
  const response = await fetch(new URL("./api/run", import.meta.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      source: sourceText,
      collapse: collapse?.value || 1,
    }),
  });
  const result = await response.json();
  const hasRuntimeShape =
    "stdout" in result || "stderr" in result || "timedOut" in result || "code" in result || "signal" in result;
  if (!response.ok && result.error && !hasRuntimeShape) {
    throw new Error(result.error);
  }
  return result;
}

async function postRun(sourceText) {
  if (runtimeMode?.value === "webgpu") {
    return postRunWebGpuRawUnsupported();
  }
  if (runtimeMode?.value === "server") {
    return await postRunServer(sourceText);
  }
  const browserResult = postRunBrowser(sourceText);
  if (browserResult) {
    return await browserResult;
  }
  return await postRunServer(sourceText);
}

async function runGeneratedSearch(search) {
  if (runtimeMode?.value === "webgpu") {
    if (search.variantPlans?.length) {
      return await runCompiledSearch(search, {
        collapse: collapse?.value || 1,
        preferWebGpu: true,
        timeoutMs: BROWSER_RUN_TIMEOUT_MS,
      });
    }
    const browserResult = postRunBrowser(search.program);
    if (browserResult) {
      const result = await browserResult;
      return {
        ...result,
        stderr: `${result.stderr || ""}${result.stderr ? "\n" : ""}FastSearch note: this generator has no compiled variant metadata yet, so it used Browser Worker fallback.\n`,
      };
    }
    return await postRunServer(search.program);
  }
  return await postRun(search.program);
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function inlineMarkdown(text) {
  return escapeHtml(text).replace(/`([^`]+)`/g, "<code>$1</code>");
}

function renderMarkdown(markdown) {
  const lines = markdown.split(/\r?\n/);
  const html = [];
  let inCode = false;
  let code = [];
  let listKind = "";

  function closeList() {
    if (listKind) {
      html.push(`</${listKind}>`);
      listKind = "";
    }
  }

  function closeCode() {
    html.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
    code = [];
    inCode = false;
  }

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inCode) {
        closeCode();
      } else {
        closeList();
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      code.push(line);
      continue;
    }

    if (line.trim() === "") {
      closeList();
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      closeList();
      html.push(`<h${heading[1].length}>${inlineMarkdown(heading[2])}</h${heading[1].length}>`);
      continue;
    }

    const item = line.match(/^-\s+(.*)$/);
    if (item) {
      if (listKind !== "ul") {
        closeList();
        html.push("<ul>");
        listKind = "ul";
      }
      html.push(`<li>${inlineMarkdown(item[1])}</li>`);
      continue;
    }

    const orderedItem = line.match(/^\d+\.\s+(.*)$/);
    if (orderedItem) {
      if (listKind !== "ol") {
        closeList();
        html.push("<ol>");
        listKind = "ol";
      }
      html.push(`<li>${inlineMarkdown(orderedItem[1])}</li>`);
      continue;
    }

    closeList();
    html.push(`<p>${inlineMarkdown(line)}</p>`);
  }

  closeList();
  if (inCode) {
    closeCode();
  }
  return html.join("");
}

async function loadDoc(path) {
  docs.innerHTML = "<p>Loading...</p>";
  docTabs.forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.doc === path);
  });
  try {
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(`Could not load ${path}`);
    }
    docs.innerHTML = renderMarkdown(await response.text());
  } catch (err) {
    docs.innerHTML = `<p>${escapeHtml(String(err.message || err))}</p>`;
  }
}

async function runProgram() {
  setDisabled(runProgramButton, true);
  output.textContent = "";

  try {
    const result = await postRun(source.value);
    output.textContent = formatResult(result) || "(no output)";
  } catch (err) {
    output.textContent = String(err.message || err);
  } finally {
    setDisabled(runProgramButton, false);
  }
}

let currentTinySearch = null;

function selectedTinyPreset() {
  return tinyPresets[tinyPreset.value] || tinyPresets.natInc;
}

function setTinyPreset(name) {
  tinyPreset.value = name;
  const preset = selectedTinyPreset();
  tinyDepth.value = String(preset.depth);
  searchDialect.value = preset.dialect || "library";
  tinySpec.value = preset.spec;
  currentTinySearch = null;
  tinySummary.textContent = "Generate a typed search program.";
  tinyOutput.textContent = "Run Search to synthesize from the spec.";
}

function formatHelper(helper) {
  if (helper.typed) {
    const args = (helper.args || []).map((arg) => `${arg.name}: ${arg.type}`).join(", ");
    return `${helper.name}(${args}) -> ${helper.ret}`;
  }
  return helper.name;
}

function summarizeTinySearch(search) {
  const target = search.spec.target;
  if (search.mode === "choiceVector") {
    const fastIR = buildFastSearchIR(search);
    const dialectText = search.primitiveSet?.label || search.dialect || "unknown";
    const helperText = search.spec.helpers.length
      ? `Helpers: ${search.spec.helpers.map(formatHelper).join(", ")}\n`
      : "";
    const engineText = search.engine ? `Engine: ${search.engine}\n` : "";
    const choices = Array.isArray(search.choices)
      ? search.choices
          .map((choice, index) => `${choice.name || `choice ${index}`}: ${choice.items?.length || 0}`)
          .join("\n")
      : [
          search.choices.sortNil ? `sort []: ${search.choices.sortNil.length}` : "",
          search.choices.sortCons ? `sort cons: ${search.choices.sortCons.length}` : "",
          search.choices.auxNil ? `${search.choices.helperName} []: ${search.choices.auxNil.length}` : "",
          search.choices.auxCons ? `${search.choices.helperName} cons: ${search.choices.auxCons.length}` : "",
        ]
          .filter(Boolean)
          .join("\n");
    return (
      `Target: ${target.name}(${target.args.map((arg) => `${arg.name}: ${arg.type}`).join(", ")}) -> ${target.ret}\n` +
      engineText +
      `Dialect: ${dialectText}\n` +
      helperText +
      `Depth: ${search.depth}\n` +
      `User assertions: ${search.spec.assertions.length}\n` +
      `Total tests: ${search.assertions.length}\n\n` +
      `FastSearchIR:\n` +
      `Choices: ${fastIR.dimensions.length}\n` +
      `Candidate space: ${fastIR.candidateCountText}\n` +
      `Structured decode: ${fastIR.canDecodeChoiceVector ? "yes" : "no"}\n\n` +
      `Structural choices:\n` +
      choices
    );
  }
  const helperText = search.spec.helpers.length
    ? `Helpers: ${search.spec.helpers.map(formatHelper).join(", ")}\n`
    : "";
  const sample = search.candidates
    .slice(0, 8)
    .map((candidate, index) => `#${index} ${candidate.source.replace(/\n/g, " ")}`)
    .join("\n");
  const more = search.candidates.length > 8 ? `\n... ${search.candidates.length - 8} more` : "";
  return (
    `Target: ${target.name}(${target.args.map((arg) => `${arg.name}: ${arg.type}`).join(", ")}) -> ${target.ret}\n` +
    helperText +
    `Depth: ${search.depth}\n` +
    `Assertions: ${search.spec.assertions.length}\n` +
    `Generated candidates: ${search.candidates.length}\n\n` +
    sample +
    more
  );
}

function generateTinyIntoEditor() {
  const search = buildTinySearch(tinySpec.value, {
    depth: tinyDepth.value,
    dialect: selectedSearchDialect(),
  });
  currentTinySearch = search;
  source.value = search.program;
  output.textContent = "";
  tinySummary.textContent = summarizeTinySearch(search);
  tinyOutput.textContent = "Generated BabySupVM search program in the editor.";
  return search;
}

function formatTinyResult(search, result) {
  if (search.mode === "choiceVector") {
    const firstLine = (result.stdout || "").trim().split(/\r?\n/)[0] || "";
    const match = firstLine.match(/^\[([^\]]*)\]/);
    if (!match) {
      return `No surviving choice vector was returned.\n\nRaw output:\n${(formatResult(result) || "(no output)").trim()}`;
    }
    const vector = match[1]
      .split(",")
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isFinite(item));
    return [
      `Found generated choice vector: [${vector.join(",")}]`,
      search.decodeChoiceVector(vector),
      "Raw output:",
      (formatResult(result) || "(no output)").trim(),
    ].join("\n\n");
  }

  const candidateId = parseTinyCandidateId(result);
  const parts = [];
  if (candidateId !== null && search.candidates[candidateId]) {
    const candidate = search.candidates[candidateId];
    parts.push(`Found #${candidateId}: ${candidate.name}`);
    parts.push(candidate.source);
  } else {
    parts.push("No surviving candidate ID was returned.");
  }
  parts.push("Raw output:");
  parts.push((formatResult(result) || "(no output)").trim());
  return parts.join("\n\n");
}

async function runTinySearch() {
  setDisabled(runTiny, true);
  setDisabled(runProgramButton, true);
  output.textContent = "";
  tinyOutput.textContent = "";

  try {
    const search = generateTinyIntoEditor();
    const result = await runGeneratedSearch(search);
    output.textContent = formatResult(result) || "(no output)";
    tinyOutput.textContent = formatTinyResult(search, result);
  } catch (err) {
    const msg = String(err.message || err);
    output.textContent = msg;
    tinyOutput.textContent = msg;
  } finally {
    setDisabled(runTiny, false);
    setDisabled(runProgramButton, false);
  }
}

docTabs.forEach((tab) => {
  tab.addEventListener("click", () => loadDoc(tab.dataset.doc));
});

Object.entries(tinyPresets).forEach(([key, preset]) => {
  const option = document.createElement("option");
  option.value = key;
  option.textContent = preset.title;
  tinyPreset.append(option);
});
Object.entries(genericSearchDialects).forEach(([key, dialect]) => {
  const option = document.createElement("option");
  option.value = key;
  option.textContent = dialect.label;
  searchDialect.append(option);
});
Object.entries(engineModes).forEach(([key, mode]) => {
  const option = document.createElement("option");
  option.value = key;
  option.textContent = mode.title;
  engineMode.append(option);
});
tinyPreset.addEventListener("change", () => setTinyPreset(tinyPreset.value));
searchDialect.addEventListener("change", () => {
  try {
    currentTinySearch = null;
    generateTinyIntoEditor();
  } catch (err) {
    const msg = String(err.message || err);
    tinyOutput.textContent = msg;
  }
});
engineMode.addEventListener("change", previewSelectedEngine);
runTiny?.addEventListener("click", runTinySearch);
previewEngine?.addEventListener("click", previewSelectedEngine);
loadEngineDemo?.addEventListener("click", loadSelectedEngineDemo);
runProgramButton?.addEventListener("click", runProgram);
clear?.addEventListener("click", () => {
  output.textContent = "";
});
source?.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    runProgram();
  }
});
tinySpec?.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    runTinySearch();
  }
});

if (runtimeMode) {
  runtimeMode.value = "webgpu";
}
setTinyPreset("natInc");
generateTinyIntoEditor();
engineMode.value = "genericSupGen";
previewSelectedEngine();
loadDoc("./spec/syntax.md");
