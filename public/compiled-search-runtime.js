const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_RECURSION = 2000;

const astCache = new Map();

function nowMs() {
  return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
}

function truthy(value) {
  if (Array.isArray(value)) {
    return value.length !== 0;
  }
  return value === true || value === 1;
}

function deepEqual(left, right) {
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((item, index) => deepEqual(item, right[index]));
  }
  return left === right;
}

function splitTopLevel(text, separator = ",") {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "(" || char === "[" || char === "{") {
      depth += 1;
    } else if (char === ")" || char === "]" || char === "}") {
      depth -= 1;
    } else if (char === separator && depth === 0) {
      out.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  const tail = text.slice(start).trim();
  if (tail) {
    out.push(tail);
  }
  return out;
}

function isWrapped(text) {
  if (!text.startsWith("(") || !text.endsWith(")")) {
    return false;
  }
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0 && index !== text.length - 1) {
        return false;
      }
    }
  }
  return depth === 0;
}

function stripOuter(text) {
  let out = text.trim();
  while (isWrapped(out)) {
    out = out.slice(1, -1).trim();
  }
  return out;
}

function findTopLevelWord(text, word, startAt = 0) {
  let depth = 0;
  for (let index = startAt; index <= text.length - word.length; index += 1) {
    const char = text[index];
    if (char === "(" || char === "[" || char === "{") {
      depth += 1;
      continue;
    }
    if (char === ")" || char === "]" || char === "}") {
      depth -= 1;
      continue;
    }
    if (depth !== 0 || !text.startsWith(word, index)) {
      continue;
    }
    const before = text[index - 1] || " ";
    const after = text[index + word.length] || " ";
    if (!/[A-Za-z0-9_$]/.test(before) && !/[A-Za-z0-9_$]/.test(after)) {
      return index;
    }
  }
  return -1;
}

function findTopLevelToken(text, token, startAt = 0) {
  let depth = 0;
  for (let index = startAt; index <= text.length - token.length; index += 1) {
    const char = text[index];
    if (char === "(" || char === "[" || char === "{") {
      depth += 1;
      continue;
    }
    if (char === ")" || char === "]" || char === "}") {
      depth -= 1;
      continue;
    }
    if (depth === 0 && text.startsWith(token, index)) {
      return index;
    }
  }
  return -1;
}

function previousNonSpace(text, index) {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (!/\s/.test(text[cursor])) {
      return text[cursor];
    }
  }
  return "";
}

function findRightTopLevelOperator(text, ops) {
  let depth = 0;
  for (let index = text.length - 1; index >= 0; index -= 1) {
    const char = text[index];
    if (char === ")" || char === "]" || char === "}") {
      depth += 1;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") {
      depth -= 1;
      continue;
    }
    if (depth !== 0) {
      continue;
    }
    for (const op of ops) {
      const start = index - op.length + 1;
      if (start < 0 || !text.startsWith(op, start)) {
        continue;
      }
      if ((op === "+" || op === "-") && !previousNonSpace(text, start)) {
        continue;
      }
      if (op === "-" && /[([,+\-*/%<>=!]/.test(previousNonSpace(text, start))) {
        continue;
      }
      return { index: start, op };
    }
  }
  return null;
}

function parseExpression(raw) {
  const text = stripOuter(String(raw).trim().replace(/@([A-Za-z_$][A-Za-z0-9_$]*)/g, "$1"));
  if (astCache.has(text)) {
    return astCache.get(text);
  }

  let ast = null;

  if (text.startsWith("1n+(") && text.endsWith(")")) {
    ast = {
      kind: "binary",
      op: "+",
      left: parseExpression(text.slice(4, -1)),
      right: { kind: "int", value: 1 },
    };
  }

  if (!ast && text.startsWith("λ{0n:0n; 1n+:λp.p}(") && text.endsWith(")")) {
    ast = {
      kind: "predNat",
      value: parseExpression(text.slice("λ{0n:0n; 1n+:λp.p}(".length, -1)),
    };
  }

  if (!ast && text.startsWith("λ{")) {
    const matcher = parseMatcherApplication(text);
    if (matcher) {
      ast = matcher;
    }
  }

  if (text.startsWith("if ")) {
    const thenAt = findTopLevelWord(text, "then", 3);
    const elseAt = thenAt < 0 ? -1 : findTopLevelWord(text, "else", thenAt + 4);
    if (thenAt >= 0 && elseAt >= 0) {
      ast = {
        kind: "if",
        cond: parseExpression(text.slice(3, thenAt)),
        yes: parseExpression(text.slice(thenAt + 4, elseAt)),
        no: parseExpression(text.slice(elseAt + 4)),
      };
    }
  }

  if (!ast) {
    const consAt = findTopLevelToken(text, "<>");
    if (consAt >= 0) {
      ast = {
        kind: "cons",
        head: parseExpression(text.slice(0, consAt)),
        tail: parseExpression(text.slice(consAt + 2)),
      };
    }
  }

  if (!ast) {
    for (const word of ["xor", "or", "and"]) {
      const at = findTopLevelWord(text, word);
      if (at >= 0) {
        ast = {
          kind: "binary",
          op: word,
          left: parseExpression(text.slice(0, at)),
          right: parseExpression(text.slice(at + word.length)),
        };
        break;
      }
    }
  }

  if (!ast) {
    const cmp = findTopLevelComparison(text);
    if (cmp) {
      ast = {
        kind: "binary",
        op: cmp.op,
        left: parseExpression(text.slice(0, cmp.index)),
        right: parseExpression(text.slice(cmp.index + cmp.op.length)),
      };
    }
  }

  if (!ast) {
    const add = findRightTopLevelOperator(text, ["+", "-"]);
    if (add) {
      ast = {
        kind: "binary",
        op: add.op,
        left: parseExpression(text.slice(0, add.index)),
        right: parseExpression(text.slice(add.index + add.op.length)),
      };
    }
  }

  if (!ast) {
    const mul = findRightTopLevelOperator(text, ["*", "/", "%"]);
    if (mul) {
      ast = {
        kind: "binary",
        op: mul.op,
        left: parseExpression(text.slice(0, mul.index)),
        right: parseExpression(text.slice(mul.index + mul.op.length)),
      };
    }
  }

  if (!ast && text.startsWith("[") && text.endsWith("]")) {
    const inner = text.slice(1, -1).trim();
    ast = {
      kind: "list",
      items: inner ? splitTopLevel(inner).map(parseExpression) : [],
    };
  }

  if (!ast) {
    const call = text.match(/^([A-Za-z_$][A-Za-z0-9_$]*)\((.*)\)$/);
    if (call && matchingCallText(call[0], call[1], call[2])) {
      ast = {
        kind: "call",
        name: call[1],
        args: call[2].trim() ? splitTopLevel(call[2]).map(parseExpression) : [],
      };
    }
  }

  if (!ast && /^-?\d+n?$/.test(text)) {
    ast = { kind: "int", value: Number(text.replace(/n$/, "")) };
  }
  if (!ast && (text === "true" || text === "false")) {
    ast = { kind: "bool", value: text === "true" };
  }
  if (!ast && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(text)) {
    ast = { kind: "var", name: text };
  }

  if (!ast) {
    throw new Error(`Unsupported generated expression: ${text}`);
  }
  astCache.set(text, ast);
  return ast;
}

function matchingCallText(full, _name, args) {
  let depth = 0;
  const openAt = full.indexOf("(");
  for (let index = openAt; index < full.length; index += 1) {
    const char = full[index];
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0 && index !== full.length - 1) {
        return false;
      }
    }
  }
  return depth === 0 && typeof args === "string";
}

function findTopLevelComparison(text) {
  const ops = ["===", "<=", ">=", "==", "!=", "<", ">"];
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "(" || char === "[" || char === "{") {
      depth += 1;
      continue;
    }
    if (char === ")" || char === "]" || char === "}") {
      depth -= 1;
      continue;
    }
    if (depth !== 0) {
      continue;
    }
    for (const op of ops) {
      if (text.startsWith(op, index)) {
        return { index, op };
      }
    }
  }
  return null;
}

function parseMatcherApplication(text) {
  let depth = 0;
  let bodyEnd = -1;
  for (let index = 1; index < text.length; index += 1) {
    const char = text[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        bodyEnd = index;
        break;
      }
    }
  }
  if (bodyEnd < 0 || text[bodyEnd + 1] !== "(" || !text.endsWith(")")) {
    return null;
  }
  const body = text.slice(2, bodyEnd);
  const arg = text.slice(bodyEnd + 2, -1);
  const cases = splitTopLevel(body, ";").map((entry) => {
    const cut = findTopLevelToken(entry, ":");
    if (cut < 0) {
      return null;
    }
    return [entry.slice(0, cut).trim(), entry.slice(cut + 1).trim()];
  });
  if (cases.some((entry) => !entry)) {
    return null;
  }
  const zero = cases.find(([name]) => name === "0")?.[1];
  const one = cases.find(([name]) => name === "1")?.[1];
  if (zero !== undefined && one !== undefined) {
    return {
      kind: "if",
      cond: parseExpression(arg),
      yes: parseExpression(one),
      no: parseExpression(zero),
    };
  }
  return null;
}

function evalAst(ast, env, fns) {
  switch (ast.kind) {
    case "int":
    case "bool":
      return ast.value;
    case "var":
      if (ast.name in env) {
        return env[ast.name];
      }
      throw new Error(`Unknown generated variable: ${ast.name}`);
    case "list":
      return ast.items.map((item) => evalAst(item, env, fns));
    case "cons": {
      const tail = evalAst(ast.tail, env, fns);
      if (!Array.isArray(tail)) {
        throw new Error("Generated cons tail did not evaluate to a list");
      }
      return [evalAst(ast.head, env, fns), ...tail];
    }
    case "if":
      return truthy(evalAst(ast.cond, env, fns))
        ? evalAst(ast.yes, env, fns)
        : evalAst(ast.no, env, fns);
    case "predNat":
      return Math.max(0, evalAst(ast.value, env, fns) - 1);
    case "binary":
      return evalBinary(ast.op, evalAst(ast.left, env, fns), evalAst(ast.right, env, fns));
    case "call": {
      const fn = fns[ast.name];
      if (!fn) {
        throw new Error(`Unknown generated function: ${ast.name}`);
      }
      return fn(...ast.args.map((arg) => evalAst(arg, env, fns)));
    }
    default:
      throw new Error(`Unknown generated AST node: ${ast.kind}`);
  }
}

function evalBinary(op, left, right) {
  switch (op) {
    case "+":
      return left + right;
    case "-":
      return left - right;
    case "*":
      return left * right;
    case "/":
      return right === 0 ? 0 : Math.trunc(left / right);
    case "%":
      return right === 0 ? 0 : left % right;
    case "<=":
      return left <= right;
    case ">=":
      return left >= right;
    case "<":
      return left < right;
    case ">":
      return left > right;
    case "==":
    case "===":
      return deepEqual(left, right);
    case "!=":
      return !deepEqual(left, right);
    case "and":
      return truthy(left) && truthy(right);
    case "or":
      return truthy(left) || truthy(right);
    case "xor":
      return truthy(left) !== truthy(right);
    default:
      throw new Error(`Unknown generated operator: ${op}`);
  }
}

function evalExpr(text, env = {}, fns = {}) {
  return evalAst(parseExpression(text), env, fns);
}

function parseValue(text) {
  return evalExpr(text.replace(/(\d+)n\b/g, "$1"));
}

function parseAssertions(search) {
  return (search.assertions || search.spec.assertions || []).map((assertion) => ({
    args: assertion.args.map(parseValue),
    expected: parseValue(assertion.expected),
    generated: Boolean(assertion.generated),
  }));
}

function assertTime(started, timeoutMs) {
  if (nowMs() - started > timeoutMs) {
    throw Object.assign(new Error("compiled search timed out"), { timedOut: true });
  }
}

function checkedCall(depth, fn) {
  if (depth > MAX_RECURSION) {
    throw new Error("generated recursion exceeded limit");
  }
  return fn(depth + 1);
}

function validateAssertions(assertions, runTarget) {
  for (const assertion of assertions) {
    const actual = runTarget(...assertion.args);
    if (!deepEqual(actual, assertion.expected)) {
      return false;
    }
  }
  return true;
}

function shouldReturnSurvivor(context) {
  if (context.kth > 0) {
    context.kth -= 1;
    return false;
  }
  return true;
}

function formatStdout(vector, checks, elapsedMs, runtime, acceleratorNote) {
  return [
    `[${vector.join(",")}] #${checks}`,
    `- Checks: ${checks}`,
    `- Runtime: ${runtime}`,
    `- Elapsed: ${Math.round(elapsedMs)}ms`,
    acceleratorNote ? `- Accelerator: ${acceleratorNote}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatCandidateStdout(candidateId, checks, elapsedMs, runtime, acceleratorNote) {
  return [
    `${candidateId} #${checks}`,
    `- Checks: ${checks}`,
    `- Runtime: ${runtime}`,
    `- Elapsed: ${Math.round(elapsedMs)}ms`,
    acceleratorNote ? `- Accelerator: ${acceleratorNote}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function resultFromVector(vector, started, checks, runtime, acceleratorNote, collapseRequested) {
  return {
    ok: true,
    code: 0,
    signal: null,
    timedOut: false,
    stdout: `${formatStdout(vector, checks, nowMs() - started, runtime, acceleratorNote)}\n`,
    stderr: "",
    valueText: `[${vector.join(",")}]`,
    interactions: checks,
    elapsedMs: Math.round(nowMs() - started),
    collapseRequested,
    runtime,
  };
}

function resultFromCandidateId(candidateId, started, checks, runtime, acceleratorNote, collapseRequested) {
  return {
    ok: true,
    code: 0,
    signal: null,
    timedOut: false,
    stdout: `${formatCandidateStdout(candidateId, checks, nowMs() - started, runtime, acceleratorNote)}\n`,
    stderr: "",
    valueText: String(candidateId),
    interactions: checks,
    elapsedMs: Math.round(nowMs() - started),
    collapseRequested,
    runtime,
  };
}

function failureResult(message, started, checks, runtime, collapseRequested, timedOut = false) {
  return {
    ok: false,
    code: timedOut ? null : 1,
    signal: timedOut ? "FAST_SEARCH_TIMEOUT" : null,
    timedOut,
    stdout: "",
    stderr: `${message}\n`,
    valueText: null,
    interactions: checks,
    elapsedMs: Math.round(nowMs() - started),
    collapseRequested,
    error: message,
    runtime,
  };
}

function getHelperName(search, fallback = "aux") {
  return search.spec.helpers?.[0]?.name || fallback;
}

function directSearch(search, assertions, context) {
  const bodyChoice = search.variantPlans?.[0]?.choices?.[0] || search.choices[0];
  const argNames = search.spec.target.args.map((arg) => arg.name);
  const targetName = search.spec.target.name;
  for (let body = 0; body < bodyChoice.items.length; body += 1) {
    assertTime(context.started, context.timeoutMs);
    context.checks += 1;
    const source = bodyChoice.items[body].source;
    const fns = {};
    const runTarget = (...args) => {
      const env = Object.fromEntries(argNames.map((name, index) => [name, args[index]]));
      return evalExpr(source, env, fns);
    };
    fns[targetName] = runTarget;
    if (!validateAssertions(assertions, runTarget)) {
      continue;
    }
    if (shouldReturnSurvivor(context)) {
      return [body];
    }
  }
  return null;
}

function directCandidateSearch(search, assertions, context) {
  const bodyChoice = search.variantPlans?.[0]?.choices?.[0] || search.choices?.[0];
  if (!bodyChoice?.items?.length) {
    throw new Error("direct candidate search is missing candidate bodies");
  }
  const argNames = search.spec.target.args.map((arg) => arg.name);
  const targetName = search.spec.target.name;
  for (let index = 0; index < bodyChoice.items.length; index += 1) {
    assertTime(context.started, context.timeoutMs);
    context.checks += 1;
    const source = bodyChoice.items[index].source;
    const fns = {};
    const runTarget = (...args) => {
      const env = Object.fromEntries(argNames.map((name, argIndex) => [name, args[argIndex]]));
      return evalExpr(source, env, fns);
    };
    fns[targetName] = runTarget;
    if (!validateAssertions(assertions, runTarget)) {
      continue;
    }
    if (shouldReturnSurvivor(context)) {
      return index;
    }
  }
  return null;
}

function runIntListToListHelperVariant(search, variant, assertions, context) {
  const [helperNil, helperCons, targetNil, targetCons] = variant.choices;
  const targetName = search.spec.target.name;
  const helperName = getHelperName(search, "aux");

  for (let hNil = 0; hNil < helperNil.items.length; hNil += 1) {
    for (let hCons = 0; hCons < helperCons.items.length; hCons += 1) {
      for (let tNil = 0; tNil < targetNil.items.length; tNil += 1) {
        for (let tCons = 0; tCons < targetCons.items.length; tCons += 1) {
          assertTime(context.started, context.timeoutMs);
          context.checks += 1;
          const fns = {};
          const helper = (x, xs, depth = 0) =>
            checkedCall(depth, (nextDepth) => {
              if (!xs.length) {
                return evalExpr(helperNil.items[hNil].source, { x, xs }, fns);
              }
              const [y, ...ys] = xs;
              return evalExpr(helperCons.items[hCons].source, { x, xs, y, ys }, {
                ...fns,
                [helperName]: (nextX, nextXs) => helper(nextX, nextXs, nextDepth),
              });
            });
          const target = (xs, depth = 0) =>
            checkedCall(depth, (nextDepth) => {
              if (!xs.length) {
                return evalExpr(targetNil.items[tNil].source, { xs }, fns);
              }
              const [x, ...rest] = xs;
              return evalExpr(targetCons.items[tCons].source, { x, rest }, {
                ...fns,
                [targetName]: (nextXs) => target(nextXs, nextDepth),
                [helperName]: (nextX, nextXs) => helper(nextX, nextXs, nextDepth),
              });
            });
          fns[targetName] = target;
          fns[helperName] = helper;
          fns.__generic_list_helper = helper;
          fns.__generic_list_struct_helper = target;
          if (validateAssertions(assertions, target) && shouldReturnSurvivor(context)) {
            return [variant.index, hNil, hCons, tNil, tCons];
          }
        }
      }
    }
  }
  return null;
}

function derivePredicateExpectations(assertions) {
  const expected = new Map();
  for (const assertion of assertions) {
    const input = assertion.args[0];
    const output = assertion.expected;
    if (!Array.isArray(input) || !Array.isArray(output)) {
      return null;
    }
    let cursor = 0;
    for (const value of input) {
      const keep = cursor < output.length && deepEqual(value, output[cursor]);
      if (keep) {
        cursor += 1;
      }
      if (expected.has(value) && expected.get(value) !== keep) {
        return null;
      }
      expected.set(value, keep);
    }
    if (cursor !== output.length) {
      return null;
    }
  }
  return Array.from(expected.entries());
}

function makePredAux(auxChoices, vector) {
  const [guardChoice, testChoice, hitChoice, stepChoice, carryChoice, doneChoice] = auxChoices;
  const [guard, test, hit, step, carry, done] = vector;
  return function predAux(d, n) {
    let currentD = d;
    let currentN = n;
    for (let steps = 0; steps < MAX_RECURSION; steps += 1) {
      const env = { d: currentD, n: currentN };
      if (!truthy(evalExpr(guardChoice.items[guard].source, env))) {
        return truthy(evalExpr(doneChoice.items[done].source, env));
      }
      if (truthy(evalExpr(testChoice.items[test].source, env))) {
        return truthy(evalExpr(hitChoice.items[hit].source, env));
      }
      currentD = evalExpr(stepChoice.items[step].source, env);
      currentN = evalExpr(carryChoice.items[carry].source, env);
    }
    throw new Error("predicate helper recursion exceeded limit");
  };
}

function predMatchesExamples(pred, expectations) {
  if (!expectations) {
    return true;
  }
  for (const [value, expected] of expectations) {
    if (truthy(pred(value)) !== expected) {
      return false;
    }
  }
  return true;
}

function runIntListToListPredicateVariant(search, variant, assertions, context) {
  const [predChoice, ...rest] = variant.choices;
  const auxChoices = rest.slice(0, 6);
  const nilChoice = rest[6];
  const consChoice = rest[7];
  const helperName = getHelperName(search, "pred");
  const targetName = search.spec.target.name;
  const expectations = derivePredicateExpectations(assertions);

  for (let predIdx = 0; predIdx < predChoice.items.length; predIdx += 1) {
    const predItem = predChoice.items[predIdx];
    const auxVectors = predItem.usesNumericHelper
      ? cartesianRanges(auxChoices.map((choice) => choice.items.length))
      : [[0, 0, 0, 0, 0, 0]];
    for (const auxVector of auxVectors) {
      assertTime(context.started, context.timeoutMs);
      context.checks += 1;
      const predAux = makePredAux(auxChoices, auxVector);
      const pred = (p) =>
        truthy(evalExpr(predItem.source, { p }, {
          [`${helperName}Aux`]: predAux,
          __generic_pred_aux: predAux,
          predAux,
        }));
      if (!predMatchesExamples(pred, expectations)) {
        continue;
      }
      for (let nil = 0; nil < nilChoice.items.length; nil += 1) {
        for (let cons = 0; cons < consChoice.items.length; cons += 1) {
          assertTime(context.started, context.timeoutMs);
          context.checks += 1;
          const fns = {};
          const target = (xs, depth = 0) =>
            checkedCall(depth, (nextDepth) => {
              if (!xs.length) {
                return evalExpr(nilChoice.items[nil].source, {}, fns);
              }
              const [x, ...restList] = xs;
              return evalExpr(consChoice.items[cons].source, { x, rest: restList }, {
                ...fns,
                [targetName]: (nextXs) => target(nextXs, nextDepth),
                [helperName]: pred,
              });
            });
          fns[targetName] = target;
          fns[helperName] = pred;
          fns.__generic_pred = pred;
          fns.__generic_list_struct_pred = target;
          if (validateAssertions(assertions, target) && shouldReturnSurvivor(context)) {
            return [variant.index, predIdx, ...auxVector, nil, cons];
          }
        }
      }
    }
  }
  return null;
}

function runIntListToIntStateVariant(search, variant, assertions, context) {
  const [stateChoice, hiReducerChoice, lowReducerChoice, finishChoice, nilChoice] = variant.choices;
  const targetName = search.spec.target.name;
  const helperName = getHelperName(search, "aux");

  for (let state = 0; state < stateChoice.items.length; state += 1) {
    const stateItem = stateChoice.items[state];
    for (let hiReduce = 0; hiReduce < hiReducerChoice.items.length; hiReduce += 1) {
      for (let lowReduce = 0; lowReduce < lowReducerChoice.items.length; lowReduce += 1) {
        for (let finish = 0; finish < finishChoice.items.length; finish += 1) {
          for (let nil = 0; nil < nilChoice.items.length; nil += 1) {
            assertTime(context.started, context.timeoutMs);
            context.checks += 1;
            const fns = {};
            const high = (a, b) => evalExpr(hiReducerChoice.items[hiReduce].source, { a, b }, fns);
            const low = (a, b) => evalExpr(lowReducerChoice.items[lowReduce].source, { a, b }, fns);
            const scan = (xs, depth = 0) =>
              checkedCall(depth, (nextDepth) => {
                if (!xs.length) {
                  return [];
                }
                const [x, ...restList] = xs;
                const restState = scan(restList, nextDepth);
                if (!restState.length) {
                  return evalExpr(stateItem.singleSource || stateItem.source, { x }, fns);
                }
                const [hi, lowValue] = restState;
                return [
                  high(evalExpr(stateItem.hiInput || "x", { x }, fns), hi),
                  low(evalExpr(stateItem.lowInput || "x", { x }, fns), lowValue),
                ];
              });
            const target = (xs) => {
              const stateValue = scan(xs);
              if (!stateValue.length) {
                return evalExpr(nilChoice.items[nil].source, {}, fns);
              }
              const [hi, low] = stateValue;
              return evalExpr(finishChoice.items[finish].source, { hi, low }, {
                ...fns,
                [targetName]: target,
                [helperName]: (x, hiValue, lowValue) => [
                  high(evalExpr(stateItem.hiInput || "x", { x }, fns), hiValue),
                  low(evalExpr(stateItem.lowInput || "x", { x }, fns), lowValue),
                ],
              });
            };
            fns[targetName] = target;
            fns.__generic_state = scan;
            fns.__generic_state_target = target;
            fns.__generic_state_high = high;
            fns.__generic_state_low = low;
            if (validateAssertions(assertions, target) && shouldReturnSurvivor(context)) {
              return [variant.index, state, hiReduce, lowReduce, finish, nil];
            }
          }
        }
      }
    }
  }
  return null;
}

function runIntListToIntDirectVariant(search, variant, assertions, context) {
  const [combineChoice, nilChoice, consChoice] = variant.choices;
  const targetName = search.spec.target.name;
  const helperName = getHelperName(search, "aux");
  for (let combine = 0; combine < combineChoice.items.length; combine += 1) {
    for (let nil = 0; nil < nilChoice.items.length; nil += 1) {
      for (let cons = 0; cons < consChoice.items.length; cons += 1) {
        assertTime(context.started, context.timeoutMs);
        context.checks += 1;
        const fns = {};
        const helper = (a, b) => evalExpr(combineChoice.items[combine].source, { a, b }, fns);
        const target = (xs, depth = 0) =>
          checkedCall(depth, (nextDepth) => {
            if (!xs.length) {
              return evalExpr(nilChoice.items[nil].source, {}, fns);
            }
            const [x, ...rest] = xs;
            return evalExpr(consChoice.items[cons].source, { x, rest }, {
              ...fns,
              [targetName]: (nextXs) => target(nextXs, nextDepth),
              [helperName]: helper,
            });
          });
        fns[targetName] = target;
        fns[helperName] = helper;
        fns.__generic_reduce = helper;
        fns.__generic_direct = target;
        if (validateAssertions(assertions, target) && shouldReturnSurvivor(context)) {
          return [variant.index, combine, nil, cons];
        }
      }
    }
  }
  return null;
}

function runIntListToIntFilteredVariant(search, variant, assertions, context) {
  const [predChoice, ...rest] = variant.choices;
  const auxChoices = rest.slice(0, 6);
  const nilChoice = rest[6];
  const consChoice = rest[7];
  const helperName = getHelperName(search, "pred");
  const targetName = search.spec.target.name;

  for (let predIdx = 0; predIdx < predChoice.items.length; predIdx += 1) {
    const predItem = predChoice.items[predIdx];
    const auxVectors = predItem.usesNumericHelper
      ? cartesianRanges(auxChoices.map((choice) => choice.items.length))
      : [[0, 0, 0, 0, 0, 0]];
    for (const auxVector of auxVectors) {
      const predAux = makePredAux(auxChoices, auxVector);
      const pred = (p) =>
        truthy(evalExpr(predItem.source, { p }, {
          [`${helperName}Aux`]: predAux,
          __generic_pred_aux: predAux,
          predAux,
        }));
      for (let nil = 0; nil < nilChoice.items.length; nil += 1) {
        for (let cons = 0; cons < consChoice.items.length; cons += 1) {
          assertTime(context.started, context.timeoutMs);
          context.checks += 1;
          const fns = {};
          const target = (xs, depth = 0) =>
            checkedCall(depth, (nextDepth) => {
              if (!xs.length) {
                return evalExpr(nilChoice.items[nil].source, {}, fns);
              }
              const [x, ...restList] = xs;
              return evalExpr(consChoice.items[cons].source, { x, rest: restList }, {
                ...fns,
                [targetName]: (nextXs) => target(nextXs, nextDepth),
                [helperName]: pred,
                __generic_pred: pred,
                __generic_filtered: (nextXs) => target(nextXs, nextDepth),
              });
            });
          fns[targetName] = target;
          fns[helperName] = pred;
          fns.__generic_pred = pred;
          fns.__generic_filtered = target;
          try {
            if (validateAssertions(assertions, target) && shouldReturnSurvivor(context)) {
              return [variant.index, predIdx, ...auxVector, nil, cons];
            }
          } catch (_err) {
            // Some generated recursive terms are ill-founded for a given candidate.
          }
        }
      }
    }
  }
  return null;
}

function runIntListToIntGenericVariant(search, variant, assertions, context) {
  const [nilChoice, consChoice] = variant.choices;
  const targetName = search.spec.target.name;
  for (let nil = 0; nil < nilChoice.items.length; nil += 1) {
    for (let cons = 0; cons < consChoice.items.length; cons += 1) {
      assertTime(context.started, context.timeoutMs);
      context.checks += 1;
      const fns = {};
      const target = (xs, depth = 0) =>
        checkedCall(depth, (nextDepth) => {
          if (!xs.length) {
            return evalExpr(nilChoice.items[nil].source, {}, fns);
          }
          const [x, ...rest] = xs;
          return evalExpr(consChoice.items[cons].source, { x, rest }, {
            ...fns,
            [targetName]: (nextXs) => target(nextXs, nextDepth),
          });
        });
      fns[targetName] = target;
      fns.__generic_struct_int = target;
      if (validateAssertions(assertions, target) && shouldReturnSurvivor(context)) {
        return [variant.index, nil, cons];
      }
    }
  }
  return null;
}

function runNestedListToListVariant(search, variant, assertions, context) {
  const [appendNil, appendCons, targetNil, targetCons] = variant.choices;
  const targetName = search.spec.target.name;
  const helperName = getHelperName(search, "append");
  for (let aNil = 0; aNil < appendNil.items.length; aNil += 1) {
    for (let aCons = 0; aCons < appendCons.items.length; aCons += 1) {
      for (let tNil = 0; tNil < targetNil.items.length; tNil += 1) {
        for (let tCons = 0; tCons < targetCons.items.length; tCons += 1) {
          assertTime(context.started, context.timeoutMs);
          context.checks += 1;
          const fns = {};
          const helper = (xs, ys, depth = 0) =>
            checkedCall(depth, (nextDepth) => {
              if (!xs.length) {
                return evalExpr(appendNil.items[aNil].source, { xs, ys }, fns);
              }
              const [x, ...rest] = xs;
              return evalExpr(appendCons.items[aCons].source, { x, rest, ys }, {
                ...fns,
                [helperName]: (nextXs, nextYs) => helper(nextXs, nextYs, nextDepth),
              });
            });
          const target = (xss, depth = 0) =>
            checkedCall(depth, (nextDepth) => {
              if (!xss.length) {
                return evalExpr(targetNil.items[tNil].source, { xss }, fns);
              }
              const [xs, ...rest] = xss;
              return evalExpr(targetCons.items[tCons].source, { xs, rest }, {
                ...fns,
                [targetName]: (nextXss) => target(nextXss, nextDepth),
                [helperName]: (left, right) => helper(left, right, nextDepth),
              });
            });
          fns[targetName] = target;
          fns[helperName] = helper;
          fns.__generic_nested_helper = helper;
          fns.__generic_nested_struct = target;
          if (validateAssertions(assertions, target) && shouldReturnSurvivor(context)) {
            return [variant.index, aNil, aCons, tNil, tCons];
          }
        }
      }
    }
  }
  return null;
}

function cartesianRanges(lengths) {
  const out = [];
  const vector = new Array(lengths.length).fill(0);
  function go(index) {
    if (index === lengths.length) {
      out.push(vector.slice());
      return;
    }
    for (let item = 0; item < lengths[index]; item += 1) {
      vector[index] = item;
      go(index + 1);
    }
  }
  go(0);
  return out;
}

function runVariant(search, variant, assertions, context) {
  if (variant.direct) {
    return directSearch(search, assertions, context);
  }
  if (variant.source.includes("nested-list")) {
    return runNestedListToListVariant(search, variant, assertions, context);
  }
  if (variant.source.includes("predicate helper")) {
    return runIntListToListPredicateVariant(search, variant, assertions, context);
  }
  if (variant.source.includes("list helper")) {
    return runIntListToListHelperVariant(search, variant, assertions, context);
  }
  if (variant.source.includes("aggregate state")) {
    return runIntListToIntStateVariant(search, variant, assertions, context);
  }
  if (variant.source.includes("filtered Int recursion")) {
    return runIntListToIntFilteredVariant(search, variant, assertions, context);
  }
  if (variant.source.includes("structural Int recursion")) {
    return runIntListToIntDirectVariant(search, variant, assertions, context);
  }
  if (variant.source.includes("structural list recursion")) {
    return runIntListToIntGenericVariant(search, variant, assertions, context);
  }
  return null;
}

const BC = Object.freeze({
  END: 0,
  CONST: 1,
  ARG: 2,
  ADD: 3,
  SUB: 4,
  MUL: 5,
  DIV: 6,
  MOD: 7,
  EQ: 8,
  LE: 9,
  LT: 10,
  GE: 11,
  GT: 12,
  NE: 13,
  SELECT: 14,
  PRED_NAT: 15,
});

function emitOp(code, op, arg = 0) {
  code.push(op, arg);
}

function compileScalarAst(ast, argNames, code) {
  switch (ast.kind) {
    case "int":
      emitOp(code, BC.CONST, ast.value);
      return;
    case "bool":
      emitOp(code, BC.CONST, ast.value ? 1 : 0);
      return;
    case "var": {
      const index = argNames.indexOf(ast.name);
      if (index < 0) {
        throw new Error(`WebGPU scalar compiler cannot load ${ast.name}`);
      }
      emitOp(code, BC.ARG, index);
      return;
    }
    case "predNat":
      compileScalarAst(ast.value, argNames, code);
      emitOp(code, BC.PRED_NAT);
      return;
    case "if":
      compileScalarAst(ast.cond, argNames, code);
      compileScalarAst(ast.yes, argNames, code);
      compileScalarAst(ast.no, argNames, code);
      emitOp(code, BC.SELECT);
      return;
    case "binary": {
      compileScalarAst(ast.left, argNames, code);
      compileScalarAst(ast.right, argNames, code);
      const op = {
        "+": BC.ADD,
        "-": BC.SUB,
        "*": BC.MUL,
        "/": BC.DIV,
        "%": BC.MOD,
        "==": BC.EQ,
        "===": BC.EQ,
        "!=": BC.NE,
        "<=": BC.LE,
        "<": BC.LT,
        ">=": BC.GE,
        ">": BC.GT,
      }[ast.op];
      if (op === undefined) {
        throw new Error(`WebGPU scalar compiler cannot lower ${ast.op}`);
      }
      emitOp(code, op);
      return;
    }
    default:
      throw new Error(`WebGPU scalar compiler cannot lower ${ast.kind}`);
  }
}

function buildWebGpuDirectPlan(search, assertions) {
  const variant = search.variantPlans?.[0];
  const bodyChoice = variant?.choices?.[0] || search.choices?.[0];
  if (!variant?.candidateId || !bodyChoice?.items?.length) {
    return null;
  }
  const argNames = search.spec.target.args.map((arg) => arg.name);
  if (!argNames.length || argNames.length > 4) {
    return null;
  }
  if (assertions.some((assertion) => Array.isArray(assertion.expected) || assertion.args.some(Array.isArray))) {
    return null;
  }

  const perCandidate = [];
  let maxPairs = 0;
  for (const item of bodyChoice.items) {
    const code = [];
    compileScalarAst(parseExpression(item.source), argNames, code);
    emitOp(code, BC.END);
    const pairs = Math.ceil(code.length / 2);
    maxPairs = Math.max(maxPairs, pairs);
    perCandidate.push(code);
  }
  const instrStride = Math.max(1, maxPairs);
  if (instrStride > 128) {
    throw new Error("WebGPU scalar candidate program exceeded instruction limit");
  }
  const code = new Int32Array(bodyChoice.items.length * instrStride * 2);
  perCandidate.forEach((candidateCode, candidate) => {
    code.set(candidateCode, candidate * instrStride * 2);
  });

  const inputValues = new Int32Array(assertions.length * argNames.length);
  const expected = new Int32Array(assertions.length);
  assertions.forEach((assertion, assertionIndex) => {
    assertion.args.forEach((arg, argIndex) => {
      inputValues[assertionIndex * argNames.length + argIndex] = Number(arg);
    });
    expected[assertionIndex] = Number(assertion.expected);
  });

  return {
    candidateCount: bodyChoice.items.length,
    assertionCount: assertions.length,
    argCount: argNames.length,
    instrStride,
    code,
    inputValues,
    expected,
  };
}

function createStorageBuffer(device, data, usage = 0) {
  const buffer = device.createBuffer({
    size: Math.max(4, data.byteLength),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | usage,
  });
  device.queue.writeBuffer(buffer, 0, data);
  return buffer;
}

function directKernelSource() {
  return `
@group(0) @binding(0) var<storage, read> code: array<i32>;
@group(0) @binding(1) var<storage, read> inputs: array<i32>;
@group(0) @binding(2) var<storage, read> expected: array<i32>;
@group(0) @binding(3) var<storage, read_write> alive: array<u32>;
@group(0) @binding(4) var<storage, read> params: array<u32>;

fn pop2(stack: ptr<function, array<i32, 32>>, sp: ptr<function, u32>) -> vec2<i32> {
  (*sp) = (*sp) - 1u;
  let b = (*stack)[(*sp)];
  (*sp) = (*sp) - 1u;
  let a = (*stack)[(*sp)];
  return vec2<i32>(a, b);
}

fn eval_candidate(candidate: u32, assertion: u32) -> i32 {
  let arg_count = params[2];
  let stride = params[3];
  var stack: array<i32, 32>;
  var sp = 0u;
  for (var pc = 0u; pc < stride; pc = pc + 1u) {
    let base = (candidate * stride + pc) * 2u;
    let op = code[base];
    let arg = code[base + 1u];
    if (op == ${BC.END}) {
      break;
    } else if (op == ${BC.CONST}) {
      stack[sp] = arg;
      sp = sp + 1u;
    } else if (op == ${BC.ARG}) {
      stack[sp] = inputs[assertion * arg_count + u32(arg)];
      sp = sp + 1u;
    } else if (op == ${BC.PRED_NAT}) {
      sp = sp - 1u;
      let value = stack[sp];
      stack[sp] = max(value - 1, 0);
      sp = sp + 1u;
    } else if (op == ${BC.SELECT}) {
      sp = sp - 1u;
      let no = stack[sp];
      sp = sp - 1u;
      let yes = stack[sp];
      sp = sp - 1u;
      let cond = stack[sp];
      stack[sp] = select(no, yes, cond != 0);
      sp = sp + 1u;
    } else {
      let pair = pop2(&stack, &sp);
      let a = pair.x;
      let b = pair.y;
      var out = 0;
      if (op == ${BC.ADD}) {
        out = a + b;
      } else if (op == ${BC.SUB}) {
        out = a - b;
      } else if (op == ${BC.MUL}) {
        out = a * b;
      } else if (op == ${BC.DIV}) {
        let safe_b = select(b, 1, b == 0);
        out = select(a / safe_b, 0, b == 0);
      } else if (op == ${BC.MOD}) {
        let safe_b = select(b, 1, b == 0);
        out = select(a % safe_b, 0, b == 0);
      } else if (op == ${BC.EQ}) {
        out = select(0, 1, a == b);
      } else if (op == ${BC.NE}) {
        out = select(0, 1, a != b);
      } else if (op == ${BC.LE}) {
        out = select(0, 1, a <= b);
      } else if (op == ${BC.LT}) {
        out = select(0, 1, a < b);
      } else if (op == ${BC.GE}) {
        out = select(0, 1, a >= b);
      } else if (op == ${BC.GT}) {
        out = select(0, 1, a > b);
      }
      stack[sp] = out;
      sp = sp + 1u;
    }
  }
  return stack[0];
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let candidate = gid.x;
  let candidate_count = params[0];
  let assertion_count = params[1];
  if (candidate >= candidate_count) {
    return;
  }
  var ok = 1u;
  for (var assertion = 0u; assertion < assertion_count; assertion = assertion + 1u) {
    if (eval_candidate(candidate, assertion) != expected[assertion]) {
      ok = 0u;
    }
  }
  alive[candidate] = ok;
}
`;
}

async function runWebGpuDirectCandidateSearch(search, assertions, context) {
  if (typeof navigator === "undefined" || !navigator.gpu) {
    return { supported: false, note: "WebGPU unavailable" };
  }
  const plan = buildWebGpuDirectPlan(search, assertions);
  if (!plan) {
    return { supported: false, note: "search is not a scalar direct candidate plan" };
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    return { supported: false, note: "WebGPU adapter unavailable" };
  }
  const device = await adapter.requestDevice();
  const codeBuffer = createStorageBuffer(device, plan.code);
  const inputBuffer = createStorageBuffer(device, plan.inputValues);
  const expectedBuffer = createStorageBuffer(device, plan.expected);
  const aliveBuffer = device.createBuffer({
    size: Math.max(4, plan.candidateCount * 4),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  const metaBuffer = createStorageBuffer(
    device,
    new Uint32Array([plan.candidateCount, plan.assertionCount, plan.argCount, plan.instrStride]),
  );
  const readBuffer = device.createBuffer({
    size: Math.max(4, plan.candidateCount * 4),
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const module = device.createShaderModule({ code: directKernelSource() });
  const pipeline = await device.createComputePipelineAsync({
    layout: "auto",
    compute: { module, entryPoint: "main" },
  });
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: codeBuffer } },
      { binding: 1, resource: { buffer: inputBuffer } },
      { binding: 2, resource: { buffer: expectedBuffer } },
      { binding: 3, resource: { buffer: aliveBuffer } },
      { binding: 4, resource: { buffer: metaBuffer } },
    ],
  });
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(Math.ceil(plan.candidateCount / 64));
  pass.end();
  encoder.copyBufferToBuffer(aliveBuffer, 0, readBuffer, 0, plan.candidateCount * 4);
  device.queue.submit([encoder.finish()]);
  await readBuffer.mapAsync(GPUMapMode.READ);
  const alive = new Uint32Array(readBuffer.getMappedRange().slice(0));
  readBuffer.unmap();
  device.destroy?.();

  context.checks += plan.candidateCount * plan.assertionCount;
  for (let index = 0; index < alive.length; index += 1) {
    if (!alive[index]) {
      continue;
    }
    if (shouldReturnSurvivor(context)) {
      return {
        supported: true,
        candidateId: index,
        note: "WebGPU direct-candidate kernel",
      };
    }
  }
  return { supported: true, candidateId: null, note: "WebGPU direct-candidate kernel" };
}

async function webGpuStatus(preferWebGpu) {
  if (!preferWebGpu) {
    return "";
  }
  if (typeof navigator === "undefined" || !navigator.gpu) {
    return "WebGPU unavailable; used compiled CPU search";
  }
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      return "WebGPU adapter unavailable; used compiled CPU search";
    }
    const device = await adapter.requestDevice();
    device.destroy?.();
    return "WebGPU device available; recursive search still executed by compiled CPU plan";
  } catch (err) {
    return `WebGPU unavailable (${String(err.message || err)}); used compiled CPU search`;
  }
}

export async function runCompiledSearch(search, options = {}) {
  const started = nowMs();
  const collapseRequested = Math.max(1, Number(options.collapse || 1) || 1);
  const context = {
    started,
    timeoutMs: Number(options.timeoutMs || DEFAULT_TIMEOUT_MS),
    kth: collapseRequested - 1,
    checks: 0,
  };
  const runtime = options.preferWebGpu ? "fastsearch-webgpu-route" : "fastsearch-cpu";

  try {
    if (!search || (search.mode !== "choiceVector" && search.mode !== "candidateId")) {
      return failureResult("Compiled search needs a BabySupGen choice-vector search object or TinySupGen candidate search.", started, 0, runtime, collapseRequested);
    }
    const assertions = parseAssertions(search);

    if (!search.variantPlans?.length) {
      return failureResult("This search object does not expose compiled variant metadata yet.", started, 0, runtime, collapseRequested);
    }

    if (search.mode === "candidateId" && search.variantPlans[0]?.candidateId) {
      let gpuNote = "";
      if (options.preferWebGpu) {
        try {
          const gpu = await runWebGpuDirectCandidateSearch(search, assertions, context);
          if (gpu.supported) {
            return gpu.candidateId !== null
              ? resultFromCandidateId(gpu.candidateId, started, context.checks, runtime, gpu.note, collapseRequested)
              : failureResult("WebGPU direct-candidate search exhausted the generated space without a survivor.", started, context.checks, runtime, collapseRequested);
          }
          gpuNote = `${gpu.note}; used compiled CPU candidate search`;
        } catch (err) {
          gpuNote = `WebGPU direct-candidate kernel failed (${String(err.message || err)}); used compiled CPU candidate search`;
        }
      }
      const candidateId = directCandidateSearch(search, assertions, context);
      return candidateId !== null
        ? resultFromCandidateId(candidateId, started, context.checks, runtime, gpuNote, collapseRequested)
        : failureResult("Compiled candidate search exhausted the generated space without a survivor.", started, context.checks, runtime, collapseRequested);
    }

    const acceleratorNote = await webGpuStatus(Boolean(options.preferWebGpu));

    if (search.variantPlans.length === 1 && search.variantPlans[0].direct) {
      const vector = directSearch(search, assertions, context);
      return vector
        ? resultFromVector(vector, started, context.checks, runtime, acceleratorNote, collapseRequested)
        : failureResult("Compiled search exhausted the direct-expression space without a survivor.", started, context.checks, runtime, collapseRequested);
    }

    for (const variant of search.variantPlans) {
      const vector = runVariant(search, variant, assertions, context);
      if (vector) {
        return resultFromVector(vector, started, context.checks, runtime, acceleratorNote, collapseRequested);
      }
    }

    return failureResult("Compiled search exhausted the supported generated space without a survivor.", started, context.checks, runtime, collapseRequested);
  } catch (err) {
    const timedOut = Boolean(err?.timedOut);
    return failureResult(String(err.message || err), started, context.checks, runtime, collapseRequested, timedOut);
  }
}

export const __compiledSearchTest = {
  deepEqual,
  evalExpr,
  parseValue,
  derivePredicateExpectations,
};
