import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, "public");
const PORT = Number(process.env.PORT || 5177);
const RUNTIME = process.env.SUPVM_RUNTIME || "supVM_full.ts";
const MAX_BODY_BYTES = 512 * 1024;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const RUN_TIMEOUT_MS = Number(process.env.SUPVM_TIMEOUT_MS || 60_000);

const CONTENT_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"],
]);

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(data),
  });
  res.end(data);
}

function sendText(res, status, text) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(text);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("request body is too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw.length === 0 ? {} : JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function cleanCollapse(value) {
  const collapse = Number(value);
  if (!Number.isFinite(collapse)) {
    return 1;
  }
  return Math.max(1, Math.min(100_000, Math.floor(collapse)));
}

function capAppend(current, chunk) {
  if (current.length >= MAX_OUTPUT_BYTES) {
    return current;
  }
  const next = current + chunk.toString("utf8");
  if (next.length <= MAX_OUTPUT_BYTES) {
    return next;
  }
  return next.slice(0, MAX_OUTPUT_BYTES) + "\n[output truncated]";
}

function parseRuntimeJson(stdout) {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {}

  const lines = trimmed.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (!line.startsWith("{") || !line.endsWith("}")) {
      continue;
    }
    try {
      return JSON.parse(line);
    } catch {}
  }
  return null;
}

function formatRuntimeStdout(result, includeStats) {
  const lines = [];
  if (typeof result.valueText === "string") {
    lines.push(`${result.valueText} #${Number(result.interactions) || 0}`);
  }
  if (includeStats && result.ok !== false) {
    lines.push(`- Itrs: ${Number(result.interactions) || 0} interactions`);
  }
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

async function runSupVm(source, collapse) {
  const runDir = path.join(os.tmpdir(), "supvm-runs");
  await mkdir(runDir, { recursive: true });
  const file = path.join(runDir, `${process.pid}-${Date.now()}-${randomUUID()}.hvm`);
  await writeFile(file, source, "utf8");

  return await new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const child = spawn(process.execPath, [RUNTIME, file, `-C${collapse}`, "-s", "--json"], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, RUN_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdout = capAppend(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = capAppend(stderr, chunk);
    });
    child.on("error", (err) => {
      stderr += String(err.stack || err.message || err);
    });
    child.on("close", async (code, signal) => {
      clearTimeout(timer);
      await rm(file, { force: true });
      const runtimeResult = parseRuntimeJson(stdout);
      const hasRuntimeResult = runtimeResult && typeof runtimeResult === "object";
      const childTimedOut = timedOut || Boolean(hasRuntimeResult && runtimeResult.timedOut);
      const runtimeError = hasRuntimeResult ? runtimeResult.error ?? null : childTimedOut ? "runtime timed out" : null;
      resolve({
        ok: hasRuntimeResult ? Boolean(runtimeResult.ok) && code === 0 && !childTimedOut : code === 0 && !childTimedOut,
        code,
        signal,
        timedOut: childTimedOut,
        stdout: hasRuntimeResult ? formatRuntimeStdout(runtimeResult, true) : stdout,
        stderr: stderr || (runtimeError && code !== 0 ? `${runtimeError}\n` : ""),
        valueText: hasRuntimeResult ? runtimeResult.valueText ?? null : null,
        interactions: hasRuntimeResult && Number.isFinite(Number(runtimeResult.interactions)) ? Number(runtimeResult.interactions) : null,
        elapsedMs: hasRuntimeResult && Number.isFinite(Number(runtimeResult.elapsedMs)) ? Number(runtimeResult.elapsedMs) : null,
        collapseRequested: hasRuntimeResult && Number.isFinite(Number(runtimeResult.collapseRequested)) ? Number(runtimeResult.collapseRequested) : collapse,
        error: runtimeError,
      });
    });
  });
}

async function handleRun(req, res) {
  try {
    const body = await readJsonBody(req);
    const source = typeof body.source === "string" ? body.source : "";
    if (source.trim().length === 0) {
      sendJson(res, 400, { ok: false, error: "empty source" });
      return;
    }
    const collapse = cleanCollapse(body.collapse);
    const result = await runSupVm(source, collapse);
    sendJson(res, result.timedOut ? 504 : 200, result);
  } catch (err) {
    sendJson(res, 400, { ok: false, error: String(err.message || err) });
  }
}

async function serveStatic(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const file = path.normalize(path.join(PUBLIC, pathname));
  if (!file.startsWith(PUBLIC + path.sep)) {
    sendText(res, 403, "forbidden");
    return;
  }

  try {
    await readFile(file);
  } catch {
    sendText(res, 404, "not found");
    return;
  }

  const ext = path.extname(file);
  res.writeHead(200, {
    "content-type": CONTENT_TYPES.get(ext) || "application/octet-stream",
  });
  createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/api/run") {
    await handleRun(req, res);
    return;
  }
  if (req.method === "GET" || req.method === "HEAD") {
    await serveStatic(req, res);
    return;
  }
  sendText(res, 405, "method not allowed");
});

server.listen(PORT, () => {
  console.log(`BabySupGen host listening on http://localhost:${PORT}`);
});
