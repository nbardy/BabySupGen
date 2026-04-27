const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const LABEL_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function tagged(tag, fields = {}) {
  return Object.freeze({ tag, ...fields });
}

function assertName(name, role = "name") {
  const clean = String(name);
  if (!IDENT_RE.test(clean)) {
    throw new Error(`Invalid ${role}: ${name}`);
  }
  return clean;
}

export function safeLabel(label) {
  const safe = String(label)
    .trim()
    .replace(/[^A-Za-z0-9_$]+/g, "_")
    .replace(/^[^A-Za-z_$]+/, "")
    .replace(/^_+$/, "");
  return safe && LABEL_RE.test(safe) ? safe : "choice";
}

export function forkLabel(parent, site, child = 0) {
  return safeLabel(`${safeLabel(parent)}_${labelPart(site)}_${labelPart(child)}`);
}

export function forkLabels(parent, site, children) {
  return Array.from(children, (child) => forkLabel(parent, site, child));
}

export const Type = Object.freeze({
  int: () => tagged("TInt"),
  bool: () => tagged("TBool"),
  list: (elem) => tagged("TList", { elem }),
  fun: (arg, ret) => tagged("TFun", { arg, ret }),
});

export const intType = Type.int;
export const boolType = Type.bool;
export const listType = Type.list;
export const funType = Type.fun;

export function sameType(left, right) {
  if (!left || !right || left.tag !== right.tag) {
    return false;
  }
  switch (left.tag) {
    case "TList":
      return sameType(left.elem, right.elem);
    case "TFun":
      return sameType(left.arg, right.arg) && sameType(left.ret, right.ret);
    default:
      return true;
  }
}

export function serializeType(type) {
  switch (type.tag) {
    case "TInt":
    case "TBool":
      return `#${type.tag}`;
    case "TList":
      return `#TList{elem:${serializeType(type.elem)}}`;
    case "TFun":
      return `#TFun{arg:${serializeType(type.arg)},ret:${serializeType(type.ret)}}`;
    default:
      throw new Error(`Unknown Type tag: ${type.tag}`);
  }
}

export const Source = Object.freeze({
  var: (name) => tagged("SVar", { name: assertName(name, "source variable") }),
  litInt: (value) => tagged("SLitInt", { value: Number(value) }),
  litBool: (value) => tagged("SLitBool", { value: Boolean(value) }),
  if: (cond, yes, no) => tagged("SIf", { cond, yes, no }),
  prim2: (op, left, right) => tagged("SPrim2", { op: String(op), left, right }),
  nil: () => tagged("SNil"),
  cons: (head, tail) => tagged("SCons", { head, tail }),
  matchList: (scrut, nilName, consName, body) =>
    tagged("SMatchList", {
      scrut,
      nilName: assertName(nilName, "nil branch name"),
      consName: assertName(consName, "cons branch name"),
      body,
    }),
  call: (name, args = []) => tagged("SCall", { name: assertName(name, "call name"), args: freezeList(args) }),
  lam: (name, type, body) => tagged("SLam", { name: assertName(name, "lambda name"), type, body }),
});

export function serializeSource(source) {
  switch (source.tag) {
    case "SVar":
      return `#SVar{name:${quote(source.name)}}`;
    case "SLitInt":
      return `#SLitInt{value:${source.value}}`;
    case "SLitBool":
      return `#SLitBool{value:${source.value ? "true" : "false"}}`;
    case "SIf":
      return `#SIf{cond:${serializeSource(source.cond)},yes:${serializeSource(source.yes)},no:${serializeSource(source.no)}}`;
    case "SPrim2":
      return `#SPrim2{op:${quote(source.op)},left:${serializeSource(source.left)},right:${serializeSource(source.right)}}`;
    case "SNil":
      return "#SNil";
    case "SCons":
      return `#SCons{head:${serializeSource(source.head)},tail:${serializeSource(source.tail)}}`;
    case "SMatchList":
      return `#SMatchList{scrut:${serializeSource(source.scrut)},nilName:${quote(source.nilName)},consName:${quote(source.consName)},body:${serializeSource(source.body)}}`;
    case "SCall":
      return `#SCall{name:${quote(source.name)},args:[${source.args.map(serializeSource).join(",")}]}`;
    case "SLam":
      return `#SLam{name:${quote(source.name)},type:${serializeType(source.type)},body:${serializeSource(source.body)}}`;
    default:
      throw new Error(`Unknown Source tag: ${source.tag}`);
  }
}

export function printSource(source) {
  switch (source.tag) {
    case "SVar":
      return source.name;
    case "SLitInt":
      return String(source.value);
    case "SLitBool":
      return String(source.value);
    case "SIf":
      return `if ${printSource(source.cond)} then ${printSource(source.yes)} else ${printSource(source.no)}`;
    case "SPrim2":
      return `${printSource(source.left)} ${source.op} ${printSource(source.right)}`;
    case "SNil":
      return "[]";
    case "SCons":
      return `${printSource(source.head)} <> ${printSource(source.tail)}`;
    case "SMatchList":
      return `match ${printSource(source.scrut)} { [] => ${source.nilName}; <> => ${source.consName} -> ${printSource(source.body)} }`;
    case "SCall":
      return `${source.name}(${source.args.map(printSource).join(",")})`;
    case "SLam":
      return `lambda ${source.name}. ${printSource(source.body)}`;
    default:
      throw new Error(`Unknown Source tag: ${source.tag}`);
  }
}

export function lowerSourceValue(source) {
  switch (source.tag) {
    case "SVar":
      return source.name;
    case "SLitInt":
      return String(source.value);
    case "SLitBool":
      return source.value ? "1" : "0";
    case "SNil":
      return "[]";
    case "SCons":
      return `${lowerSourceValue(source.head)} <> ${lowerSourceValue(source.tail)}`;
    case "SPrim2":
      return `${lowerSourceValue(source.left)} ${source.op} ${lowerSourceValue(source.right)}`;
    case "SIf":
      return `\u03bb{0:${lowerSourceValue(source.no)}; 1:${lowerSourceValue(source.yes)}}(${lowerSourceValue(source.cond)})`;
    case "SCall":
      return `@${source.name}(${source.args.map(lowerSourceValue).join(",")})`;
    case "SLam":
      return `\u03bb${source.name}. ${lowerSourceValue(source.body)}`;
    default:
      throw new Error(`Cannot lower Source tag as value yet: ${source.tag}`);
  }
}

export const Path = Object.freeze({
  nil: () => tagged("PNil"),
  cons: (label, index, tail = Path.nil()) =>
    tagged("PCons", { label: safeLabel(label), index: Number(index), tail }),
});

export function serializePath(path) {
  switch (path.tag) {
    case "PNil":
      return "#PNil";
    case "PCons":
      return `#PCons{label:${quote(path.label)},index:${path.index},tail:${serializePath(path.tail)}}`;
    default:
      throw new Error(`Unknown Path tag: ${path.tag}`);
  }
}

export const Ctx = Object.freeze({
  nil: () => tagged("CNil"),
  binding: (name, type, value = Source.var(name), options = {}) =>
    tagged("CtxBinding", {
      name: assertName(name, "context binding"),
      type,
      value,
      smallerThan: options.smallerThan == null ? null : assertName(options.smallerThan, "smaller base"),
      restricted: options.restricted || null,
    }),
  cons: (binding, tail = Ctx.nil()) => tagged("CCons", { binding: normalizeBinding(binding), tail }),
  from: (bindings = []) => {
    let ctx = Ctx.nil();
    for (let index = bindings.length - 1; index >= 0; index -= 1) {
      ctx = Ctx.cons(bindings[index], ctx);
    }
    return ctx;
  },
  toArray: (ctx) => ctxToArray(ctx),
});

export function serializeCtx(ctx) {
  switch (ctx.tag) {
    case "CNil":
      return "#CNil";
    case "CCons":
      return `#CCons{binding:${serializeCtxBinding(ctx.binding)},tail:${serializeCtx(ctx.tail)}}`;
    default:
      throw new Error(`Unknown Ctx tag: ${ctx.tag}`);
  }
}

export function serializeCtxBinding(binding) {
  if (binding.tag !== "CtxBinding") {
    throw new Error(`Unknown Ctx binding tag: ${binding.tag}`);
  }
  const smaller = binding.smallerThan == null ? "null" : quote(binding.smallerThan);
  const restricted = binding.restricted == null ? "null" : quote(binding.restricted);
  return `#CBinding{name:${quote(binding.name)},type:${serializeType(binding.type)},value:${serializeSource(binding.value)},smallerThan:${smaller},restricted:${restricted}}`;
}

export function lookupBinding(ctx, name) {
  const clean = assertName(name, "lookup name");
  return ctxToArray(ctx).find((binding) => binding.name === clean) || null;
}

export function bindingsOfType(ctx, type) {
  return ctxToArray(ctx).filter((binding) => sameType(binding.type, type));
}

export function isStructurallySmaller(ctx, argName, baseName) {
  const arg = assertName(argName, "call argument");
  const base = assertName(baseName, "structural base");
  const seen = new Set();
  let cursor = lookupBinding(ctx, arg);
  while (cursor && cursor.smallerThan && !seen.has(cursor.name)) {
    if (cursor.smallerThan === base) {
      return true;
    }
    seen.add(cursor.name);
    cursor = lookupBinding(ctx, cursor.smallerThan);
  }
  return false;
}

export function canMakeSmallerCall(ctx, args, policy) {
  const index = Number(policy.structuralArgIndex ?? 0);
  const baseName = policy.baseName;
  if (!Array.isArray(args) || index < 0 || index >= args.length || !baseName) {
    return false;
  }
  const arg = args[index];
  const argName = typeof arg === "string" ? arg : arg?.name;
  return Boolean(argName && isStructurallySmaller(ctx, argName, baseName));
}

export function assertSmallerCall(ctx, args, policy) {
  if (!canMakeSmallerCall(ctx, args, policy)) {
    const index = Number(policy.structuralArgIndex ?? 0);
    const arg = Array.isArray(args) ? args[index] : null;
    const argName = typeof arg === "string" ? arg : arg?.name || "<missing>";
    throw new Error(`Recursive call must use a structurally smaller argument than ${policy.baseName}: ${argName}`);
  }
  return true;
}

export function generatedRecord(type, source, value = lowerSourceValue(source), path = Path.nil()) {
  return tagged("Gen", { type, source, value: String(value), path });
}

export function serializeGenerated(gen) {
  if (gen.tag !== "Gen") {
    throw new Error(`Unknown Generated tag: ${gen.tag}`);
  }
  return `#Gen{type:${serializeType(gen.type)},source:${serializeSource(gen.source)},value:${gen.value},path:${serializePath(gen.path)}}`;
}

export function helperTypeRecord(name, type, options = {}) {
  const label = safeLabel(options.label || `${name}_type`);
  const index = Number(options.index || 0);
  return tagged("HelperType", {
    name: assertName(name, "helper name"),
    type,
    label,
    path: Path.cons(label, index),
    bodyLabel: forkLabel(label, "body", 0),
    targetLabel: forkLabel(label, "target", 0),
  });
}

export function serializeHelperType(record) {
  if (record.tag !== "HelperType") {
    throw new Error(`Unknown helper type record tag: ${record.tag}`);
  }
  return `#HelperType{name:${quote(record.name)},type:${serializeType(record.type)},label:${quote(record.label)},path:${serializePath(record.path)},bodyLabel:${quote(record.bodyLabel)},targetLabel:${quote(record.targetLabel)}}`;
}

export function genTermDirect(goalType, ctx = Ctx.nil(), options = {}) {
  const label = safeLabel(options.label || "direct_atom");
  const literals = atomLiterals(goalType, options);
  const variables = bindingsOfType(ctx, goalType).map((binding) => ({
    source: Source.var(binding.name),
    value: lowerSourceValue(binding.value),
  }));
  const atoms = [...variables, ...literals];
  return atoms.map((atom, index) =>
    generatedRecord(goalType, atom.source, atom.value ?? lowerSourceValue(atom.source), Path.cons(label, index)),
  );
}

function atomLiterals(goalType, options) {
  switch (goalType.tag) {
    case "TInt":
      return Array.from(options.intLiterals || [0, 1], (value) => ({
        source: Source.litInt(value),
      }));
    case "TBool":
      return Array.from(options.boolLiterals || [false, true], (value) => ({
        source: Source.litBool(value),
      }));
    default:
      return [];
  }
}

function ctxToArray(ctx) {
  const out = [];
  let cursor = ctx;
  while (cursor && cursor.tag === "CCons") {
    out.push(cursor.binding);
    cursor = cursor.tail;
  }
  if (!cursor || cursor.tag !== "CNil") {
    throw new Error(`Unknown Ctx tag: ${cursor?.tag}`);
  }
  return out;
}

function normalizeBinding(binding) {
  if (binding?.tag === "CtxBinding") {
    return binding;
  }
  return Ctx.binding(binding.name, binding.type, binding.value, binding);
}

function freezeList(items) {
  return Object.freeze(Array.from(items));
}

function quote(value) {
  return JSON.stringify(String(value));
}

function labelPart(value) {
  const safe = String(value)
    .trim()
    .replace(/[^A-Za-z0-9_$]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return safe || "part";
}
