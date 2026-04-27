import { runBabySupVm } from "./babysupvm-runtime.js";

self.onmessage = (event) => {
  const { id, source, collapse } = event.data || {};
  try {
    self.postMessage({
      id,
      result: runBabySupVm(source, { collapse }),
    });
  } catch (err) {
    self.postMessage({
      id,
      result: {
        ok: false,
        code: 1,
        signal: null,
        timedOut: false,
        stdout: "",
        stderr: `${String(err?.message || err)}\n`,
        valueText: null,
        interactions: 0,
        elapsedMs: 0,
        collapseRequested: Number(collapse) || 1,
        error: String(err?.message || err),
        runtime: "browser-worker",
      },
    });
  }
};
