const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const LABEL_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function typeTag(tag, fields = {}) {
  return Object.freeze({ tag, ...fields });
}

export const Type = Object.freeze({
  int: () => typeTag("Int"),
  bool: () => typeTag("Bool"),
  unit: () => typeTag("Unit"),
  list: (of) => typeTag("List", { of }),
  fun: (from, to) => typeTag("Fun", { from, to }),
  name: (name) => typeTag("Name", { name }),
});

export const intType = Type.int;
export const boolType = Type.bool;
export const unitType = Type.unit;
export const listType = Type.list;
export const funType = Type.fun;
export const nameType = Type.name;

export function parseType(text) {
  const parser = new TypeParser(text);
  const type = parser.parseType();
  parser.expectEnd();
  return type;
}

export function showType(type) {
  switch (type.tag) {
    case "Int":
    case "Bool":
    case "Unit":
      return type.tag;
    case "Name":
      return type.name;
    case "List":
      return `${showTypeAtom(type.of)}[]`;
    case "Fun":
      return `${showTypeFunArg(type.from)} -> ${showType(type.to)}`;
    default:
      throw new Error(`Unknown type tag: ${type.tag}`);
  }
}

export function sameType(left, right) {
  if (left.tag !== right.tag) {
    return false;
  }
  switch (left.tag) {
    case "List":
      return sameType(left.of, right.of);
    case "Fun":
      return sameType(left.from, right.from) && sameType(left.to, right.to);
    case "Name":
      return left.name === right.name;
    default:
      return true;
  }
}

function showTypeAtom(type) {
  return type.tag === "Fun" ? `(${showType(type)})` : showType(type);
}

function showTypeFunArg(type) {
  return type.tag === "Fun" ? `(${showType(type)})` : showType(type);
}

class TypeParser {
  constructor(text) {
    this.text = String(text);
    this.index = 0;
  }

  parseType() {
    return this.parseArrow();
  }

  parseArrow() {
    const from = this.parsePostfix();
    this.skip();
    if (!this.consume("->")) {
      return from;
    }
    return Type.fun(from, this.parseArrow());
  }

  parsePostfix() {
    let type = this.parseAtom();
    for (;;) {
      this.skip();
      if (!this.consume("[]")) {
        return type;
      }
      type = Type.list(type);
    }
  }

  parseAtom() {
    this.skip();
    if (this.consume("(")) {
      const type = this.parseType();
      this.skip();
      this.expect(")");
      return type;
    }
    const name = this.parseName();
    if (name === "List") {
      this.skip();
      this.expect("<");
      const inner = this.parseType();
      this.skip();
      this.expect(">");
      return Type.list(inner);
    }
    if (name === "Fun") {
      this.skip();
      this.expect("<");
      const from = this.parseType();
      this.skip();
      this.expect(",");
      const to = this.parseType();
      this.skip();
      this.expect(">");
      return Type.fun(from, to);
    }
    if (name === "Int") {
      return Type.int();
    }
    if (name === "Bool") {
      return Type.bool();
    }
    if (name === "Unit") {
      return Type.unit();
    }
    return Type.name(name);
  }

  parseName() {
    this.skip();
    const match = this.text.slice(this.index).match(/[A-Za-z_$][A-Za-z0-9_$]*/);
    if (!match || match.index !== 0) {
      throw new Error(`Expected type name at ${this.index}: ${this.text}`);
    }
    this.index += match[0].length;
    return match[0];
  }

  skip() {
    while (/\s/.test(this.text[this.index] || "")) {
      this.index += 1;
    }
  }

  consume(token) {
    if (!this.text.startsWith(token, this.index)) {
      return false;
    }
    this.index += token.length;
    return true;
  }

  expect(token) {
    if (!this.consume(token)) {
      throw new Error(`Expected ${token} at ${this.index}: ${this.text}`);
    }
  }

  expectEnd() {
    this.skip();
    if (this.index !== this.text.length) {
      throw new Error(`Unexpected type input at ${this.index}: ${this.text}`);
    }
  }
}

function termTag(tag, fields = {}) {
  return Object.freeze({ tag, ...fields });
}

export const Term = Object.freeze({
  var: (name, type = null) => termTag("Var", { name, type }),
  int: (value) => termTag("Int", { value: Number(value) }),
  bool: (value) => termTag("Bool", { value: Boolean(value) }),
  unit: () => termTag("Unit"),
  prim: (op, args) => termTag("Prim", { op, args: Array.from(args) }),
  if: (cond, thenTerm, elseTerm) => termTag("If", { cond, thenTerm, elseTerm }),
  list: (items = []) => termTag("List", { items: Array.from(items) }),
  cons: (head, tail) => termTag("Cons", { head, tail }),
  match: (scrutinee, cases) => termTag("Match", { scrutinee, cases: normalizeCases(cases) }),
  lambda: (params, body) => termTag("Lambda", { params: normalizeParams(params), body }),
  call: (fn, args = []) => termTag("Call", { fn, args: Array.from(args) }),
  rec: (name, args = []) => termTag("Rec", { name, args: Array.from(args) }),
  helper: (name, args = []) => termTag("Helper", { name, args: Array.from(args) }),
  choice: (label, options) => termTag("Choice", { label: safeLabel(label), options: Array.from(options) }),
  erase: () => termTag("Erase"),
  raw: (source) => termTag("Raw", { source: String(source) }),
});

export const varTerm = Term.var;
export const intTerm = Term.int;
export const boolTerm = Term.bool;
export const unitTerm = Term.unit;
export const primTerm = Term.prim;
export const ifTerm = Term.if;
export const listTerm = Term.list;
export const consTerm = Term.cons;
export const matchTerm = Term.match;
export const lambdaTerm = Term.lambda;
export const callTerm = Term.call;
export const recTerm = Term.rec;
export const helperTerm = Term.helper;
export const choiceTerm = Term.choice;
export const eraseTerm = Term.erase;
export const rawTerm = Term.raw;

export function sourceOf(term) {
  return printTerm(term, "source");
}

export function lowerTerm(term) {
  return printTerm(term, "supvm");
}

export function lowerDefinition(name, term) {
  assertName(name, "definition name");
  return `@${name} = ${lowerTerm(term)}`;
}

export function lowerProgram(definitions, main = null) {
  const lines = [];
  for (const definition of definitions) {
    lines.push(lowerDefinition(definition.name, definition.term));
  }
  if (main) {
    lines.push(lowerDefinition("main", main));
  }
  return `${lines.join("\n")}\n`;
}

export function uniqueItems(items, keyOf = defaultItemKey) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function safeLabel(label) {
  const safe = String(label)
    .trim()
    .replace(/[^A-Za-z0-9_$]+/g, "_")
    .replace(/^[^A-Za-z_$]+/, "")
    .replace(/^_+$/, "");
  return safe && LABEL_RE.test(safe) ? safe : "choice";
}

export function makeChoice(label, options, valueOf = lowerChoiceValue) {
  const safe = safeLabel(label);
  const normalized = uniqueItems(
    Array.from(options, (option) => normalizeChoiceOption(option, valueOf)),
    (option) => option.key,
  );
  if (normalized.length === 0) {
    throw new Error(`Cannot build empty choice: ${safe}`);
  }
  return {
    label: safe,
    options: normalized,
    term: binaryChoice(safe, normalized.map((option) => option.term)),
    id: binaryChoice(safe, normalized.map((_, index) => String(index))),
  };
}

function normalizeParams(params) {
  const list = Array.isArray(params) ? params : [params];
  for (const param of list) {
    assertName(param, "lambda parameter");
  }
  return list.slice();
}

function normalizeCases(cases) {
  if (Array.isArray(cases)) {
    return cases.map((entry) => ({ ...entry }));
  }
  return Object.entries(cases).map(([pattern, value]) => ({ pattern, ...normalizeCaseValue(value) }));
}

function normalizeCaseValue(value) {
  if (value && typeof value === "object" && !("tag" in value) && "body" in value) {
    return { params: normalizeParams(value.params || []), body: value.body };
  }
  return { params: [], body: value };
}

function printTerm(term, mode, parentPrec = 0) {
  switch (term.tag) {
    case "Var":
      return term.name;
    case "Int":
      return String(term.value);
    case "Bool":
      return mode === "supvm" ? (term.value ? "1" : "0") : String(term.value);
    case "Unit":
      return mode === "supvm" ? "[]" : "()";
    case "Raw":
      return term.source;
    case "Erase":
      return "&{}";
    case "List":
      return `[${term.items.map((item) => printTerm(item, mode)).join(",")}]`;
    case "Cons":
      return withPrec(`${printTerm(term.head, mode, 5)} <> ${printTerm(term.tail, mode, 5)}`, 5, parentPrec);
    case "Prim":
      return printPrim(term, mode, parentPrec);
    case "If":
      if (mode === "supvm") {
        return `λ{0:${printTerm(term.elseTerm, mode)}; 1:${printTerm(term.thenTerm, mode)}}(${printTerm(term.cond, mode)})`;
      }
      return `if ${printTerm(term.cond, mode)} then ${printTerm(term.thenTerm, mode)} else ${printTerm(term.elseTerm, mode)}`;
    case "Match":
      return printMatch(term, mode);
    case "Lambda":
      return `λ${term.params.join(",")}. ${printTerm(term.body, mode)}`;
    case "Call":
      return `${printCallable(term.fn, mode)}(${term.args.map((arg) => printTerm(arg, mode)).join(",")})`;
    case "Rec":
    case "Helper":
      return printNamedCall(term.name, term.args, mode);
    case "Choice":
      return binaryChoice(term.label, term.options.map((option) => printTerm(option, mode)));
    default:
      throw new Error(`Unknown term tag: ${term.tag}`);
  }
}

function printPrim(term, mode, parentPrec) {
  if (term.args.length === 1) {
    return `${term.op}${printTerm(term.args[0], mode, 7)}`;
  }
  if (term.args.length === 2 && isInfix(term.op)) {
    const prec = primPrecedence(term.op);
    const left = printTerm(term.args[0], mode, prec);
    const right = printTerm(term.args[1], mode, prec + 1);
    return withPrec(`${left} ${term.op} ${right}`, prec, parentPrec);
  }
  return `${term.op}(${term.args.map((arg) => printTerm(arg, mode)).join(", ")})`;
}

function printMatch(term, mode) {
  if (mode === "supvm") {
    const cases = term.cases.map((entry) => `${entry.pattern}:${caseBody(entry, mode)}`).join("; ");
    return `λ{${cases}}(${printTerm(term.scrutinee, mode)})`;
  }
  const cases = term.cases.map((entry) => `${entry.pattern} => ${caseBody(entry, mode)}`).join("; ");
  return `match ${printTerm(term.scrutinee, mode)} { ${cases} }`;
}

function caseBody(entry, mode) {
  const params = normalizeParams(entry.params || []);
  if (params.length === 0) {
    return printTerm(entry.body, mode);
  }
  return `λ${params.join(",")}. ${printTerm(entry.body, mode)}`;
}

function printCallable(fn, mode) {
  if (typeof fn === "string") {
    return printNamed(fn, mode);
  }
  return printTerm(fn, mode, 9);
}

function printNamedCall(name, args, mode) {
  const ref = printNamed(name, mode);
  if (args.length === 0) {
    return ref;
  }
  return `${ref}(${args.map((arg) => printTerm(arg, mode)).join(",")})`;
}

function printNamed(name, mode) {
  const clean = String(name);
  if (clean.startsWith("@")) {
    assertName(clean.slice(1), "top-level reference");
    return mode === "supvm" ? clean : clean.slice(1);
  }
  assertName(clean, "top-level reference");
  return mode === "supvm" ? `@${clean}` : clean;
}

function binaryChoice(label, values) {
  if (values.length === 0) {
    throw new Error(`Cannot lower empty choice: ${label}`);
  }
  function go(index) {
    if (index === values.length - 1) {
      return values[index];
    }
    return `&${label}_${index}{${values[index]}; ${go(index + 1)}}`;
  }
  return go(0);
}

function normalizeChoiceOption(option, valueOf) {
  const term = valueOf(option);
  return {
    ...option,
    term,
    key: option.key || term,
  };
}

function lowerChoiceValue(option) {
  if (typeof option === "string") {
    return option;
  }
  if (option && typeof option === "object" && "term" in option) {
    return typeof option.term === "string" ? option.term : lowerTerm(option.term);
  }
  return lowerTerm(option);
}

function defaultItemKey(item) {
  if (typeof item === "string") {
    return item;
  }
  if (item && typeof item === "object") {
    if ("key" in item) {
      return item.key;
    }
    if ("term" in item) {
      return typeof item.term === "string" ? item.term : lowerTerm(item.term);
    }
  }
  return JSON.stringify(item);
}

function isInfix(op) {
  return ["+", "-", "*", "%", "<=", "===", "==", "!=", "<", ">"].includes(op);
}

function primPrecedence(op) {
  if (op === "*" || op === "%") {
    return 6;
  }
  if (op === "+" || op === "-") {
    return 5;
  }
  return 4;
}

function withPrec(text, prec, parentPrec) {
  return prec < parentPrec ? `(${text})` : text;
}

function assertName(name, role) {
  if (!IDENT_RE.test(String(name))) {
    throw new Error(`Invalid ${role}: ${name}`);
  }
}
