const SMALL_INTS = [-1, 0, 1, 2, 3, 5];

function base(name) {
  return { tag: name };
}

function list(of) {
  return { tag: "List", of };
}

function fun(from, to) {
  return { tag: "Fun", from, to };
}

export function parseType(text) {
  const src = stripParens(text.trim());
  const arrow = splitArrow(src);
  if (arrow) {
    return fun(parseType(arrow[0]), parseType(arrow[1]));
  }
  if (src.endsWith("[]")) {
    return list(parseType(src.slice(0, -2)));
  }
  const listMatch = src.match(/^List<(.+)>$/);
  if (listMatch) {
    return list(parseType(listMatch[1]));
  }
  if (src === "Int" || src === "Nat" || src === "Bool" || src === "Unit") {
    return base(src);
  }
  throw new Error(`Unsupported full type: ${text}`);
}

export function showType(type) {
  switch (type.tag) {
    case "List":
      return `${showType(type.of)}[]`;
    case "Fun":
      return `${showType(type.from)} -> ${showType(type.to)}`;
    default:
      return type.tag;
  }
}

function sameType(a, b) {
  if (a.tag !== b.tag) {
    return false;
  }
  if (a.tag === "List") {
    return sameType(a.of, b.of);
  }
  if (a.tag === "Fun") {
    return sameType(a.from, b.from) && sameType(a.to, b.to);
  }
  return true;
}

function splitArrow(src) {
  let depth = 0;
  for (let index = 0; index < src.length - 1; index += 1) {
    const char = src[index];
    if (char === "<" || char === "(") {
      depth += 1;
    } else if (char === ">" || char === ")") {
      depth -= 1;
    } else if (char === "-" && src[index + 1] === ">" && depth === 0) {
      return [src.slice(0, index).trim(), src.slice(index + 2).trim()];
    }
  }
  return null;
}

function stripParens(src) {
  if (!src.startsWith("(") || !src.endsWith(")")) {
    return src;
  }
  let depth = 0;
  for (let index = 0; index < src.length; index += 1) {
    const char = src[index];
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0 && index !== src.length - 1) {
        return src;
      }
    }
  }
  return stripParens(src.slice(1, -1).trim());
}

function choose(label, options) {
  if (options.length === 0) {
    throw new Error(`empty choice: ${label}`);
  }
  function go(index) {
    if (index === options.length - 1) {
      return options[index].term;
    }
    return `&${label}_${index}{${options[index].term}; ${go(index + 1)}}`;
  }
  return go(0);
}

function chooseIds(label, options) {
  return choose(
    label,
    options.map((_, index) => ({ term: String(index) })),
  );
}

function listLiteral(items) {
  return `[${items.join(",")}]`;
}

function intsIn(text) {
  return Array.from(text.matchAll(/-?\d+/g), (match) => Number(match[0]));
}

function encodedIntName(value) {
  return value < 0 ? `m${Math.abs(value)}` : `p${value}`;
}

function countDef(value) {
  const name = `count_${encodedIntName(value)}`;
  return `@${name} = λxs. λ{[]:0n; <>:λh,t. λ{0:@${name}(t); 1:1n+@${name}(t)}(h === ${value})}(xs)`;
}

function makeChoice(label, items, name = label) {
  return { label, name, term: choose(label, items), id: chooseIds(label, items), items };
}

function ifTerm(cond, yes, no) {
  return `λ{0:${no}; 1:${yes}}(${cond})`;
}

function andTerm(left, right) {
  return ifTerm(left, right, "0");
}

function notTerm(cond) {
  return ifTerm(cond, "0", "1");
}

function primeDefs() {
  return [];
}

function maxTerm(a, b) {
  return `λ{0:${a}; 1:${b}}(${a} <= ${b})`;
}

function minTerm(a, b) {
  return `λ{0:${b}; 1:${a}}(${a} <= ${b})`;
}

function evenCond(x) {
  return `${x} % 2 === 0`;
}

function predicateItems(x = "x") {
  return unique([
    { term: evenCond(x), source: `${x} % 2 == 0` },
    { term: `${x} <= 0`, source: `${x} <= 0` },
    { term: `0 <= ${x}`, source: `0 <= ${x}` },
    { term: `${x} === 0`, source: `${x} == 0` },
    { term: notTerm(`${x} === 0`), source: `${x} != 0` },
    { term: "1", source: "true" },
    { term: "0", source: "false" },
  ]);
}

function generatedLists(assertions, maxLen = 2) {
  const seen = new Set();
  const values = Array.from(
    new Set(assertions.flatMap((assertion) => [...intsIn(assertion.args[0]), ...intsIn(assertion.expected)]).concat([-1, 0, 1, 2])),
  ).sort((a, b) => a - b);
  const out = [];
  function go(prefix, depth) {
    const key = listLiteral(prefix);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(prefix.slice());
    }
    if (depth >= maxLen) {
      return;
    }
    for (const value of values) {
      prefix.push(value);
      go(prefix, depth + 1);
      prefix.pop();
    }
  }
  go([], 0);
  return out;
}

function buildChecks(finalBody, checks) {
  let body = finalBody;
  for (let index = checks.length - 1; index >= 0; index -= 1) {
    body = `λ{0:&{}; 1:${body}}(${checks[index]})`;
  }
  return body;
}

function generatedTerm(label, type, ctx, fuel) {
  const items = genTerm(type, ctx, fuel);
  return {
    label,
    name: label,
    term: choose(label, items),
    id: chooseIds(label, items),
    items,
  };
}

export function genTerm(type, ctx, fuel) {
  const out = [];
  for (const binding of ctx) {
    if (sameType(binding.type, type)) {
      out.push({ term: binding.name, source: binding.name });
    }
  }

  if (type.tag === "Int") {
    out.push(...SMALL_INTS.map((value) => ({ term: String(value), source: String(value) })));
    const ints = ctx.filter((binding) => binding.type.tag === "Int").map((binding) => binding.name);
    for (const name of ints) {
      out.push({ term: `${name} * ${name}`, source: `${name} * ${name}` });
      out.push({ term: `${name} + 1`, source: `${name} + 1` });
    }
    if (fuel > 0 && ints.length > 0) {
      const smaller = genTerm(type, ctx, fuel - 1).slice(0, 8);
      for (const name of ints.slice(0, 2)) {
        for (const rhs of smaller) {
          out.push({ term: `${name} + ${rhs.term}`, source: `${name} + ${rhs.source}` });
          out.push({ term: `${name} * ${rhs.term}`, source: `${name} * ${rhs.source}` });
          out.push({ term: maxTerm(name, rhs.term), source: `max(${name}, ${rhs.source})` });
          out.push({ term: maxTerm(`${name} * ${name}`, rhs.term), source: `max(${name} * ${name}, ${rhs.source})` });
        }
      }
    }
  }

  if (type.tag === "Bool") {
    out.push({ term: "1", source: "true" }, { term: "0", source: "false" });
    const ints = ctx.filter((binding) => binding.type.tag === "Int").map((binding) => binding.name);
    for (const name of ints) {
      out.push(...predicateItems(name));
    }
    for (let i = 0; i < ints.length; i += 1) {
      for (let j = i + 1; j < ints.length; j += 1) {
        out.push({ term: `${ints[i]} <= ${ints[j]}`, source: `${ints[i]} <= ${ints[j]}` });
        out.push({ term: `${ints[i]} === ${ints[j]}`, source: `${ints[i]} == ${ints[j]}` });
      }
    }
  }

  if (type.tag === "List") {
    out.push({ term: "[]", source: "[]" });
    const headsFromCtx = ctx.filter((binding) => sameType(binding.type, type.of)).map((binding) => ({
      term: binding.name,
      source: binding.name,
    }));
    const lists = ctx.filter((binding) => sameType(binding.type, type)).map((binding) => binding.name);
    for (const head of headsFromCtx) {
      out.push({ term: `[${head.term}]`, source: `[${head.source}]` });
      for (const xs of lists) {
        out.push({ term: `${head.term} <> ${xs}`, source: `${head.source} <> ${xs}` });
      }
    }
    if (fuel > 0) {
      const heads = unique([...headsFromCtx, ...genTerm(type.of, ctx, fuel - 1)]).slice(0, 8);
      const tails = genTerm(type, ctx, fuel - 1).slice(0, 8);
      for (const head of heads) {
        for (const tail of tails) {
          out.push({ term: `${head.term} <> ${tail.term}`, source: `${head.source} <> ${tail.source}` });
        }
      }
    }
  }

  if (type.tag === "Fun" && fuel > 0) {
    const name = freshName(ctx, "a");
    const body = genTerm(type.to, [...ctx, { name, type: type.from }], fuel - 1).slice(0, 32);
    for (const item of body) {
      out.push({ term: `λ${name}.${item.term}`, source: `λ${name}. ${item.source}` });
    }
  }

  return unique(out).slice(0, 64);
}

function freshName(ctx, baseName) {
  const used = new Set(ctx.map((binding) => binding.name));
  let name = baseName;
  let index = 0;
  while (used.has(name)) {
    index += 1;
    name = `${baseName}${index}`;
  }
  return name;
}

function unique(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (seen.has(item.term)) {
      continue;
    }
    seen.add(item.term);
    out.push(item);
  }
  return out;
}

function targetType(spec) {
  return spec.target.args.reduceRight((ret, arg) => fun(parseType(arg.type), ret), parseType(spec.target.ret));
}

function buildListToInt(spec, depth) {
  if (spec.target.args.length !== 1 || spec.target.args[0].type !== "Int[]" || spec.target.ret !== "Int") {
    return null;
  }
  const target = spec.target.name;
  const helper = spec.helpers[0]?.name || "aux";
  const checks = spec.assertions.map((assertion) => `@${target}(${assertion.args[0]}) === ${assertion.expected}`);

  const helperCtx = [
    { name: "a", type: parseType("Int") },
    { name: "b", type: parseType("Int") },
  ];
  const foldHelperItems = unique([
    { term: maxTerm("a", "b"), source: "max(a, b)" },
    { term: minTerm("a", "b"), source: "min(a, b)" },
    ...genTerm(parseType("Int"), helperCtx, Math.max(1, depth - 1)),
  ]);
  const foldNilItems = genTerm(parseType("Int"), [], 1);
  const rec = "@target_fold(rest)";
  const directReducers = spec.helpers.length
    ? []
    : [
        { term: maxTerm("x", rec), source: `max(x, ${target}(rest))` },
        { term: maxTerm("x * x", rec), source: `max(x * x, ${target}(rest))` },
      ];
  const foldConsItems = unique([
    { term: "x", source: "x" },
    { term: "x * x", source: "x * x" },
    { term: rec, source: `${target}(rest)` },
    { term: `@${helper}_fold(x,${rec})`, source: `${helper}(x, ${target}(rest))` },
    { term: `@${helper}_fold(x * x,${rec})`, source: `${helper}(x * x, ${target}(rest))` },
    ...directReducers,
    ...genTerm(parseType("Int"), [
      { name: "x", type: parseType("Int") },
      { name: rec, type: parseType("Int") },
    ], 1),
  ]);

  const foldHelperChoice = makeChoice("full_lti_fold_helper", foldHelperItems, `${helper}: Int -> Int -> Int`);
  const foldNilChoice = makeChoice("full_lti_fold_nil", foldNilItems, `${target} fold nil`);
  const foldConsChoice = makeChoice("full_lti_fold_cons", foldConsItems, `${target} fold cons`);

  const stateItems = unique([
    {
      term: "[x,x]",
      step: `[${maxTerm("x", "hi")},${minTerm("x", "low")}]`,
      source: "state [max(x), min(x)]",
      singleSource: "[x, x]",
      stepSource: "[max(x, hi), min(x, low)]",
    },
    {
      term: "[x * x,x]",
      step: `[${maxTerm("x * x", "hi")},${minTerm("x", "low")}]`,
      source: "state [max(x * x), min(x)]",
      singleSource: "[x * x, x]",
      stepSource: "[max(x * x, hi), min(x, low)]",
    },
    {
      term: "[x,x * x]",
      step: `[${maxTerm("x", "hi")},${minTerm("x * x", "low")}]`,
      source: "state [max(x), min(x * x)]",
      singleSource: "[x, x * x]",
      stepSource: "[max(x, hi), min(x * x, low)]",
    },
    {
      term: "[x * x,x * x]",
      step: `[${maxTerm("x * x", "hi")},${minTerm("x * x", "low")}]`,
      source: "state [max(x * x), min(x * x)]",
      singleSource: "[x * x, x * x]",
      stepSource: "[max(x * x, hi), min(x * x, low)]",
    },
  ]);
  const finishItems = unique([
    { term: "hi", source: "hi" },
    { term: "low", source: "low" },
    { term: "hi - low", source: "hi - low" },
    { term: "low - hi", source: "low - hi" },
    { term: "hi + low", source: "hi + low" },
    { term: "hi * low", source: "hi * low" },
    { term: maxTerm("hi", "low"), source: "max(hi, low)" },
    { term: minTerm("hi", "low"), source: "min(hi, low)" },
  ]);
  const aggregateNilItems = genTerm(parseType("Int"), [], 1);
  const stateChoice = makeChoice("full_lti_agg_state", stateItems, `${helper}: aggregate state schema`);
  stateChoice.stepTerm = choose(
    "full_lti_agg_state",
    stateItems.map((item) => ({ term: item.step })),
  );
  const finishChoice = makeChoice("full_lti_agg_finish", finishItems, `${target} aggregate finish`);
  const aggregateNilChoice = makeChoice("full_lti_agg_nil", aggregateNilItems, `${target} aggregate nil`);

  const foldVariant = {
    source: "single Int fold, helper Int -> Int -> Int",
    term: "@target_fold",
    id: `[0,${foldHelperChoice.id},${foldNilChoice.id},${foldConsChoice.id}]`,
    choices: [foldHelperChoice, foldNilChoice, foldConsChoice],
    decode(vector) {
      const [, h, n, c] = vector;
      return (
        `def ${helper}(a: Int, b: Int) -> Int:\n` +
        `  return ${foldHelperItems[h]?.source || "?"}\n\n` +
        `def ${target}(xs: Int[]) -> Int:\n` +
        `  match xs:\n` +
        `    case []:\n` +
        `      return ${foldNilItems[n]?.source || "?"}\n` +
        `    case x <> rest:\n` +
        `      return ${foldConsItems[c]?.source || "?"}`
      );
    },
  };
  const aggregateVariant = {
    source: "two Int aggregate state, helper Int -> Int -> Int -> Int[]",
    term: "@target_aggregate",
    id: `[1,${stateChoice.id},${finishChoice.id},${aggregateNilChoice.id}]`,
    choices: [stateChoice, finishChoice, aggregateNilChoice],
    decode(vector) {
      const [, state, finish, nil] = vector;
      return (
        `def ${helper}(x: Int, hi: Int, low: Int) -> Int[]:\n` +
        `  return ${stateItems[state]?.stepSource || "?"}\n\n` +
        `def ${target}(xs: Int[]) -> Int:\n` +
        `  def scan(xs: Int[]) -> Int[]:\n` +
        `    match xs:\n` +
        `      case []:\n` +
        `        return []\n` +
        `      case x <> rest:\n` +
        `        match scan(rest):\n` +
        `          case []:\n` +
        `            return ${stateItems[state]?.singleSource || "?"}\n` +
        `          case hi <> low <> _:\n` +
        `            return ${helper}(x, hi, low)\n` +
        `  match scan(xs):\n` +
        `    case []:\n` +
        `      return ${aggregateNilItems[nil]?.source || "?"}\n` +
        `    case hi <> low <> _:\n` +
        `      return ${finishItems[finish]?.source || "?"}`
      );
    },
  };
  const variants = [foldVariant, aggregateVariant];
  const variantChoice = makeChoice(
    "full_lti_variant",
    variants.map((variant) => ({ term: variant.term, source: variant.source })),
    "helper type / reduction schema",
  );
  const variantId = choose(
    "full_lti_variant",
    variants.map((variant, index) => ({ term: variant.id.replace(/^\[\d+/, `[${index}`) })),
  );
  const flattenedChoices = [
    { name: "helper type / reduction schema", items: variants.map((variant) => ({ source: variant.source, term: variant.source })) },
    ...variants.flatMap((variant) => variant.choices),
  ];
  const lines = [
    "// Generated by FullSupGen type-directed List<Int> -> Int search.",
    "// It searches both single-fold and aggregate-state reduction schemas.",
    `@${helper}_fold = λa,b.${foldHelperChoice.term}`,
    `@target_fold = λxs. λ{[]:${foldNilChoice.term}; <>:λx,rest.${foldConsChoice.term}}(xs)`,
    `@${helper}_aggregate = λx,hi,low.${stateChoice.stepTerm}`,
    `@target_state = λxs. λ{[]:[]; <>:λx,rest. λ{[]:${stateChoice.term}; <>:λhi,tail. λ{[]:${stateChoice.term}; <>:λlow,extra.@${helper}_aggregate(x,hi,low)}(tail)}(@target_state(rest))}(xs)`,
    `@target_aggregate = λxs. λ{[]:${aggregateNilChoice.term}; <>:λhi,tail. λ{[]:${aggregateNilChoice.term}; <>:λlow,extra.${finishChoice.term}}(tail)}(@target_state(xs))`,
    `@${target} = ${variantChoice.term}`,
    `@op_id = ${variantId}`,
    `@main = ${buildChecks("@op_id", checks)}`,
    "",
  ];
  return fullSearch(spec, depth, lines, flattenedChoices, (vector) => variants[vector[0]]?.decode(vector) || "Unknown surviving variant.");
}

function buildListToList(spec, depth) {
  if (spec.target.args.length !== 1 || spec.target.args[0].type !== "Int[]" || spec.target.ret !== "Int[]") {
    return null;
  }
  const target = spec.target.name;
  const helper = spec.helpers[0]?.name || "aux";
  const wantsSorted = spec.ensures.some((ensure) => ensure.includes("sorted"));
  const wantsPermutation = spec.ensures.some((ensure) => ensure.includes("permutation"));
  const assertions = wantsSorted || wantsPermutation ? withGeneratedSortAssertions(spec) : spec.assertions;
  const values = Array.from(new Set(assertions.flatMap((assertion) => intsIn(assertion.args[0]).concat(intsIn(assertion.expected))))).sort((a, b) => a - b);
  const checks = [];
  for (const assertion of assertions) {
    const input = assertion.args[0];
    checks.push(`@${target}(${input}) === ${assertion.expected}`);
    if (wantsSorted) {
      checks.push(`@sorted(@${target}(${input})) === 1`);
    }
    if (wantsPermutation) {
      for (const value of values) {
        checks.push(`@count_${encodedIntName(value)}(@${target}(${input})) === @count_${encodedIntName(value)}(${input})`);
      }
    }
  }
  const filterRec = "@target_filter(rest)";
  const predChoice = makeChoice("full_ltl_filter_pred", predicateItems("x"), `${helper}: Int -> Bool`);
  const filterNilChoice = makeChoice("full_ltl_filter_nil", [{ term: "[]", source: "[]" }], `${target} filter nil`);
  const filterConsItems = unique([
    { term: filterRec, source: `${target}(rest)` },
    { term: `x <> ${filterRec}`, source: `x <> ${target}(rest)` },
    { term: ifTerm(`@${helper}_pred(x)`, `x <> ${filterRec}`, filterRec), source: `if ${helper}(x) then x <> ${target}(rest) else ${target}(rest)` },
    { term: ifTerm(evenCond("x"), `x <> ${filterRec}`, filterRec), source: `if x % 2 == 0 then x <> ${target}(rest) else ${target}(rest)` },
  ]);
  const filterConsChoice = makeChoice("full_ltl_filter_cons", filterConsItems, `${target} filter cons`);

  const nilItems = genTerm(parseType("Int[]"), [{ name: "xs", type: parseType("Int[]") }], 1);
  const insertRec = "@target_insert(rest)";
  const consItems = unique([
    { term: "x <> rest", source: "x <> rest" },
    { term: `x <> ${insertRec}`, source: `x <> ${target}(rest)` },
    { term: insertRec, source: `${target}(rest)` },
    { term: `@${helper}_insert(x,rest)`, source: `${helper}(x, rest)` },
    { term: `@${helper}_insert(x,${insertRec})`, source: `${helper}(x, ${target}(rest))` },
  ]);
  const auxNil = genTerm(parseType("Int[]"), [
    { name: "x", type: parseType("Int") },
    { name: "xs", type: parseType("Int[]") },
  ], 1);
  const auxCons = unique([
    { term: "xs", source: "xs" },
    { term: "x <> xs", source: "x <> xs" },
    { term: `y <> @${helper}_insert(x,ys)`, source: `y <> ${helper}(x, ys)` },
    { term: ifTerm("x <= y", "x <> xs", `y <> @${helper}_insert(x,ys)`), source: `if x <= y then x <> xs else y <> ${helper}(x, ys)` },
    { term: ifTerm("y <= x", `y <> @${helper}_insert(x,ys)`, "x <> xs"), source: `if y <= x then y <> ${helper}(x, ys) else x <> xs` },
  ]);

  const nilChoice = makeChoice("full_ltl_insert_nil", nilItems, `${target} insert nil`);
  const consChoice = makeChoice("full_ltl_insert_cons", consItems, `${target} insert cons`);
  const auxNilChoice = makeChoice("full_ltl_insert_aux_nil", auxNil, `${helper}: Int -> Int[] -> Int[] nil`);
  const auxConsChoice = makeChoice("full_ltl_insert_aux_cons", auxCons, `${helper}: Int -> Int[] -> Int[] cons`);

  const filterVariant = {
    source: "filter recursion, helper Int -> Bool",
    term: "@target_filter",
    id: `[0,${predChoice.id},${filterNilChoice.id},${filterConsChoice.id}]`,
    choices: [predChoice, filterNilChoice, filterConsChoice],
    decode(vector) {
      const [, p, n, c] = vector;
      return (
        `def ${helper}(x: Int) -> Bool:\n` +
        `  return ${predChoice.items[p]?.source || "?"}\n\n` +
        `def ${target}(xs: Int[]) -> Int[]:\n` +
        `  match xs:\n` +
        `    case []:\n` +
        `      return ${filterNilChoice.items[n]?.source || "?"}\n` +
        `    case x <> rest:\n` +
        `      return ${filterConsChoice.items[c]?.source || "?"}`
      );
    },
  };
  const insertVariant = {
    source: "structural recursion, helper Int -> Int[] -> Int[]",
    term: "@target_insert",
    id: `[1,${nilChoice.id},${consChoice.id},${auxNilChoice.id},${auxConsChoice.id}]`,
    choices: [nilChoice, consChoice, auxNilChoice, auxConsChoice],
    decode(vector) {
      const [, n, c, an, ac] = vector;
      return (
        `def ${helper}(x: Int, xs: Int[]) -> Int[]:\n` +
        `  match xs:\n` +
        `    case []:\n` +
        `      return ${auxNil[an]?.source || "?"}\n` +
        `    case y <> ys:\n` +
        `      return ${auxCons[ac]?.source || "?"}\n\n` +
        `def ${target}(xs: Int[]) -> Int[]:\n` +
        `  match xs:\n` +
        `    case []:\n` +
        `      return ${nilItems[n]?.source || "?"}\n` +
        `    case x <> rest:\n` +
        `      return ${consItems[c]?.source || "?"}`
      );
    },
  };
  const variants = wantsSorted || wantsPermutation ? [insertVariant, filterVariant] : [filterVariant, insertVariant];
  const variantChoice = makeChoice(
    "full_ltl_variant",
    variants.map((variant) => ({ term: variant.term, source: variant.source })),
    "helper type / recursion schema",
  );
  const variantId = choose(
    "full_ltl_variant",
    variants.map((variant, index) => ({ term: variant.id.replace(/^\[\d+/, `[${index}`) })),
  );
  const flattenedChoices = [
    { name: "helper type / recursion schema", items: variants.map((variant) => ({ source: variant.source, term: variant.source })) },
    ...variants.flatMap((variant) => variant.choices),
  ];
  const lines = [
    "// Generated by FullSupGen type-directed List<Int> -> List<Int> search.",
    "// It searches helper type variants, not a single sort-specific candidate list.",
    ...primeDefs(),
    `@${helper}_pred = λx.${predChoice.term}`,
    `@target_filter = λxs. λ{[]:${filterNilChoice.term}; <>:λx,rest.${filterConsChoice.term}}(xs)`,
    `@${helper}_insert = λx,xs. λ{[]:${auxNilChoice.term}; <>:λy,ys.${auxConsChoice.term}}(xs)`,
    `@target_insert = λxs. λ{[]:${nilChoice.term}; <>:λx,rest.${consChoice.term}}(xs)`,
    `@${target} = ${variantChoice.term}`,
    "@sorted = λxs. λ{[]:1; <>:λx,tail. λ{[]:1; <>:λy,ys. λ{0:0; 1:@sorted(tail)}(x <= y)}(tail)}(xs)",
    ...values.map(countDef),
    `@op_id = ${variantId}`,
    `@main = ${buildChecks("@op_id", checks)}`,
    "",
  ];
  return fullSearch(spec, depth, lines, flattenedChoices, (vector) => variants[vector[0]]?.decode(vector) || "Unknown surviving variant.");
}

function withGeneratedSortAssertions(spec) {
  const seen = new Set(spec.assertions.map((assertion) => assertion.args[0]));
  const out = spec.assertions.slice();
  for (const xs of generatedLists(spec.assertions, 2)) {
    const input = listLiteral(xs);
    if (seen.has(input)) {
      continue;
    }
    seen.add(input);
    out.push({ fn: spec.target.name, args: [input], expected: listLiteral(xs.slice().sort((a, b) => a - b)) });
  }
  return out;
}

function fullSearch(spec, depth, lines, choices, decode) {
  return {
    mode: "choiceVector",
    engine: "FullSupGen",
    spec,
    depth,
    candidates: [],
    choices,
    program: lines.join("\n"),
    assertions: spec.assertions,
    decodeChoiceVector: decode,
  };
}

function hasNatType(type) {
  if (type.tag === "Nat") {
    return true;
  }
  if (type.tag === "List") {
    return hasNatType(type.of);
  }
  if (type.tag === "Fun") {
    return hasNatType(type.from) || hasNatType(type.to);
  }
  return false;
}

function buildExpressionSearch(spec, depth) {
  const retType = parseType(spec.target.ret);
  const argTypes = spec.target.args.map((arg) => ({ name: arg.name, type: parseType(arg.type) }));
  if ([retType, ...argTypes.map((arg) => arg.type)].some(hasNatType)) {
    return null;
  }
  const bodyChoice = generatedTerm("full_expr_body", retType, argTypes, depth);
  let targetBody = bodyChoice.term;
  for (let index = spec.target.args.length - 1; index >= 0; index -= 1) {
    targetBody = `λ${spec.target.args[index].name}.${targetBody}`;
  }
  const checks = spec.assertions.map((assertion) => `@${spec.target.name}(${assertion.args.join(",")}) === ${assertion.expected}`);
  const lines = [
    "// Generated by FullSupGen direct type-directed expression search.",
    ...primeDefs(),
    `@${spec.target.name} = ${targetBody}`,
    `@op_id = [${bodyChoice.id}]`,
    `@main = ${buildChecks("@op_id", checks)}`,
    "",
  ];
  return fullSearch(spec, depth, lines, [bodyChoice], (vector) => {
    return (
      `def ${spec.target.name}(${spec.target.args.map((arg) => `${arg.name}: ${arg.type}`).join(", ")}) -> ${spec.target.ret}:\n` +
      `  return ${bodyChoice.items[vector[0]]?.source || "?"}`
    );
  });
}

export function buildFullSearch(spec, options = {}) {
  const depth = Number(options.depth || 3);
  return buildListToInt(spec, depth) || buildListToList(spec, depth) || buildExpressionSearch(spec, depth);
}
