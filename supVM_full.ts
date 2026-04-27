#!/usr/bin/env node

// SupVM.ts
// ========
// A tiny evaluator for the HVM subset used by InsertGen_hardcoded.hvm.
// Sup-fork captures are the only DUP form needed by that file. SupVM gives
// them the same observable branch correlation through a labelled-choice map,
// and charges captured variables as DUP-like interactions.

declare var process: any;

import fs from "node:fs";

// Source terms
// ============

export type Term =
  | Term$Add
  | Term$And
  | Term$App
  | Term$Ctr
  | Term$Div
  | Term$Eql
  | Term$Era
  | Term$Lam
  | Term$Let
  | Term$Leq
  | Term$Mat
  | Term$Mod
  | Term$Mul
  | Term$Num
  | Term$Ref
  | Term$Sub
  | Term$Sup
  | Term$Var;

export type Term$Add = { $: "Add", lft: Term, rgt: Term };
export type Term$And = { $: "And", lft: Term, rgt: Term };
export type Term$App = { $: "App", fun: Term, arg: Term };
export type Term$Ctr = { $: "Ctr", nam: string, fds: Term[] };
export type Term$Div = { $: "Div", lft: Term, rgt: Term };
export type Term$Eql = { $: "Eql", lft: Term, rgt: Term };
export type Term$Era = { $: "Era" };
export type Term$Lam = { $: "Lam", nam: string, bod: Term };
export type Term$Let = { $: "Let", nam: string, val: Term, bod: Term };
export type Term$Leq = { $: "Leq", lft: Term, rgt: Term };
export type Term$Mat = { $: "Mat", css: Case[] };
export type Term$Mod = { $: "Mod", lft: Term, rgt: Term };
export type Term$Mul = { $: "Mul", lft: Term, rgt: Term };
export type Term$Num = { $: "Num", val: number };
export type Term$Ref = { $: "Ref", nam: string };
export type Term$Sub = { $: "Sub", lft: Term, rgt: Term };
export type Term$Sup = { $: "Sup", lab: string, lft: Term, rgt: Term, cap: number };
export type Term$Var = { $: "Var", nam: string };

export type Case = Case$Ctr | Case$Num;
export type Case$Ctr = { $: "Ctr", nam: string, bod: Term };
export type Case$Num = { $: "Num", val: number, bod: Term };

export type Book = Map<string, Term>;

// Runtime values
// ==============

export type Env = Map<string, Susp>;
export type Pick = 0 | 1;
export type Choices = Map<string, Pick>;

export type Susp =
  | Susp$Add
  | Susp$And
  | Susp$App
  | Susp$Div
  | Susp$Eql
  | Susp$Leq
  | Susp$Many
  | Susp$Mod
  | Susp$Mul
  | Susp$Sub
  | Susp$Term
  | Susp$Val;

export type Susp$Add = { $: "Add", lft: Susp, rgt: Susp };
export type Susp$And = { $: "And", lft: Susp, rgt: Susp };
export type Susp$App = { $: "App", fun: Susp, arg: Susp };
export type Susp$Div = { $: "Div", lft: Susp, rgt: Susp };
export type Susp$Eql = { $: "Eql", lft: Susp, rgt: Susp };
export type Susp$Leq = { $: "Leq", lft: Susp, rgt: Susp };
export type Susp$Many = { $: "Many", lft: Susp[], rgt: Susp[], idx: number };
export type Susp$Mod = { $: "Mod", lft: Susp, rgt: Susp };
export type Susp$Mul = { $: "Mul", lft: Susp, rgt: Susp };
export type Susp$Sub = { $: "Sub", lft: Susp, rgt: Susp };
export type Susp$Term = { $: "Term", term: Term, env: Env };
export type Susp$Val = { $: "Val", val: Val };

export type Val =
  | Val$App
  | Val$Ctr
  | Val$Era
  | Val$Lam
  | Val$Mat
  | Val$Num
  | Val$Sup
  | Val$Var;

export type Val$App = { $: "App", fun: Val, arg: Susp };
export type Val$Ctr = { $: "Ctr", nam: string, fds: Susp[] };
export type Val$Era = { $: "Era" };
export type Val$Lam = { $: "Lam", nam: string, bod: Term, env: Env };
export type Val$Mat = { $: "Mat", css: Case[], env: Env };
export type Val$Num = { $: "Num", val: number };
export type Val$Sup = { $: "Sup", lab: string, lft: Susp, rgt: Susp };
export type Val$Var = { $: "Var", nam: string };

// Normal forms
// ============

export type Norm =
  | Norm$App
  | Norm$Ctr
  | Norm$Lam
  | Norm$Mat
  | Norm$Num
  | Norm$Var;

export type Norm$App = { $: "App", fun: Norm, arg: Norm };
export type Norm$Ctr = { $: "Ctr", nam: string, fds: Norm[] };
export type Norm$Lam = { $: "Lam", nam: string, bod: Norm };
export type Norm$Mat = { $: "Mat", css: NormCase[] };
export type Norm$Num = { $: "Num", val: number };
export type Norm$Var = { $: "Var", nam: string };

export type NormCase = NormCase$Ctr | NormCase$Num;
export type NormCase$Ctr = { $: "Ctr", nam: string, bod: Norm };
export type NormCase$Num = { $: "Num", val: number, bod: Norm };

export type Cnf = Cnf$Era | Cnf$Fork | Cnf$Leaf;
export type Cnf$Era = { $: "Era" };
export type Cnf$Fork = { $: "Fork", lab: string, lft: Job, rgt: Job };
export type Cnf$Leaf = { $: "Leaf", val: Norm };
export type Job = (rt: Runtime, chs: Choices) => Cnf;

// Parser state
// ============

export type Parser = {
  src: string,
  pos: number,
};

export type Runtime = {
  book: Book,
  itrs: number,
  fresh: number,
};

// Constructors
// ============

// Creates a variable term.
function Var(nam: string): Term {
  return { $: "Var", nam };
}

// Creates a reference term.
function Ref(nam: string): Term {
  return { $: "Ref", nam };
}

// Creates a lambda term.
function Lam(nam: string, bod: Term): Term {
  return { $: "Lam", nam, bod };
}

// Creates an application term.
function App(fun: Term, arg: Term): Term {
  return { $: "App", fun, arg };
}

// Creates a match term.
function Mat(css: Case[]): Term {
  return { $: "Mat", css };
}

// Creates a constructor term.
function Ctr(nam: string, fds: Term[]): Term {
  return { $: "Ctr", nam, fds };
}

// Creates a numeric term.
function Num(val: number): Term {
  return { $: "Num", val };
}

// Creates an eraser term.
function Era(): Term {
  return { $: "Era" };
}

// Creates a superposition term.
function Sup(lab: string, lft: Term, rgt: Term, cap: number): Term {
  return { $: "Sup", lab, lft, rgt, cap };
}

// Creates a let term.
function Let(nam: string, val: Term, bod: Term): Term {
  return { $: "Let", nam, val, bod };
}

// Creates a numeric addition term.
function Add(lft: Term, rgt: Term): Term {
  return { $: "Add", lft, rgt };
}

// Creates a numeric subtraction term.
function Sub(lft: Term, rgt: Term): Term {
  return { $: "Sub", lft, rgt };
}

// Creates a numeric multiplication term.
function Mul(lft: Term, rgt: Term): Term {
  return { $: "Mul", lft, rgt };
}

// Creates a numeric integer division term.
function Div(lft: Term, rgt: Term): Term {
  return { $: "Div", lft, rgt };
}

// Creates a numeric modulo term.
function Mod(lft: Term, rgt: Term): Term {
  return { $: "Mod", lft, rgt };
}

// Creates an equality term.
function Eql(lft: Term, rgt: Term): Term {
  return { $: "Eql", lft, rgt };
}

// Creates a numeric less-than-or-equal term.
function Leq(lft: Term, rgt: Term): Term {
  return { $: "Leq", lft, rgt };
}

// Creates an and term.
function And(lft: Term, rgt: Term): Term {
  return { $: "And", lft, rgt };
}

// Creates a term suspension.
function Sterm(term: Term, env: Env): Susp {
  return { $: "Term", term, env };
}

// Creates a value suspension.
function Sval(val: Val): Susp {
  return { $: "Val", val };
}

// Creates an application suspension.
function Sapp(fun: Susp, arg: Susp): Susp {
  return { $: "App", fun, arg };
}

// Creates a numeric addition suspension.
function Sadd(lft: Susp, rgt: Susp): Susp {
  return { $: "Add", lft, rgt };
}

// Creates a numeric subtraction suspension.
function Ssub(lft: Susp, rgt: Susp): Susp {
  return { $: "Sub", lft, rgt };
}

// Creates a numeric multiplication suspension.
function Smul(lft: Susp, rgt: Susp): Susp {
  return { $: "Mul", lft, rgt };
}

// Creates a numeric integer division suspension.
function Sdiv(lft: Susp, rgt: Susp): Susp {
  return { $: "Div", lft, rgt };
}

// Creates a numeric modulo suspension.
function Smod(lft: Susp, rgt: Susp): Susp {
  return { $: "Mod", lft, rgt };
}

// Creates an equality suspension.
function Seql(lft: Susp, rgt: Susp): Susp {
  return { $: "Eql", lft, rgt };
}

// Creates a numeric less-than-or-equal suspension.
function Sleq(lft: Susp, rgt: Susp): Susp {
  return { $: "Leq", lft, rgt };
}

// Creates an and suspension.
function Sand(lft: Susp, rgt: Susp): Susp {
  return { $: "And", lft, rgt };
}

// Creates a many-field equality suspension.
function Smany(lft: Susp[], rgt: Susp[], idx: number): Susp {
  return { $: "Many", lft, rgt, idx };
}

// Creates a normal variable.
function NVar(nam: string): Norm {
  return { $: "Var", nam };
}

// Creates a normal lambda.
function NLam(nam: string, bod: Norm): Norm {
  return { $: "Lam", nam, bod };
}

// Creates a normal application.
function NApp(fun: Norm, arg: Norm): Norm {
  return { $: "App", fun, arg };
}

// Creates a normal match.
function NMat(css: NormCase[]): Norm {
  return { $: "Mat", css };
}

// Creates a normal constructor.
function NCtr(nam: string, fds: Norm[]): Norm {
  return { $: "Ctr", nam, fds };
}

// Creates a normal number.
function NNum(val: number): Norm {
  return { $: "Num", val };
}

// Source preprocessing
// ====================

// Removes line comments from a source file.
function strip_comments(src: string): string {
  var out = "";
  var lin = src.split(/\r?\n/g);
  for (var idx = 0; idx < lin.length; idx++) {
    var row = lin[idx];
    var cut = row.indexOf("//");
    if (cut >= 0) {
      row = row.slice(0, cut);
    }
    out += row + "\n";
  }
  return out;
}

// Parser utilities
// ================

// Returns the current character.
function peek(ps: Parser): string {
  return ps.src[ps.pos] || "";
}

// Returns a character at an offset.
function peek_at(ps: Parser, off: number): string {
  return ps.src[ps.pos + off] || "";
}

// Tests whether parsing reached the end.
function at_end(ps: Parser): boolean {
  return ps.pos >= ps.src.length;
}

// Skips whitespace.
function skip(ps: Parser): void {
  while (!at_end(ps) && /\s/.test(peek(ps))) {
    ps.pos += 1;
  }
}

// Tests whether the source starts with a string.
function starts(ps: Parser, txt: string): boolean {
  return ps.src.startsWith(txt, ps.pos);
}

// Consumes a string if present.
function match(ps: Parser, txt: string): boolean {
  skip(ps);
  if (!starts(ps, txt)) {
    return false;
  }
  ps.pos += txt.length;
  return true;
}

// Consumes a required string.
function consume(ps: Parser, txt: string): void {
  skip(ps);
  if (!starts(ps, txt)) {
    throw new Error("expected '" + txt + "' at byte " + ps.pos);
  }
  ps.pos += txt.length;
}

// Tests whether a character can start a name.
function is_name_start(chr: string): boolean {
  return /^[A-Za-z_$]$/.test(chr);
}

// Tests whether a character can continue a name.
function is_name_char(chr: string): boolean {
  return /^[A-Za-z0-9_$]$/.test(chr);
}

// Parses a name.
function parse_name(ps: Parser): string {
  skip(ps);
  var chr = peek(ps);
  if (!is_name_start(chr)) {
    throw new Error("expected name at byte " + ps.pos);
  }
  var beg = ps.pos;
  ps.pos += 1;
  while (is_name_char(peek(ps))) {
    ps.pos += 1;
  }
  return ps.src.slice(beg, ps.pos);
}

// Program parser
// ==============

// Parses a complete program.
function parse_program(src: string): Book {
  var ps: Parser = { src: strip_comments(src), pos: 0 };
  var bk: Book = new Map();
  while (true) {
    skip(ps);
    if (at_end(ps)) {
      return bk;
    }
    consume(ps, "@");
    var nam = parse_name(ps);
    consume(ps, "=");
    var val = parse_term(ps);
    bk.set(nam, val);
  }
}

// Term parser
// ===========

// Parses a term.
function parse_term(ps: Parser): Term {
  return parse_eql(ps);
}

// Parses equality.
function parse_eql(ps: Parser): Term {
  var lhs = parse_cons(ps);
  skip(ps);
  if (starts(ps, "===")) {
    ps.pos += 3;
    var rhs = parse_eql(ps);
    return Eql(lhs, rhs);
  }
  if (starts(ps, "<=")) {
    ps.pos += 2;
    var rhs = parse_eql(ps);
    return Leq(lhs, rhs);
  }
  return lhs;
}

// Parses cons syntax.
function parse_cons(ps: Parser): Term {
  var lhs = parse_add(ps);
  skip(ps);
  if (starts(ps, "<>")) {
    ps.pos += 2;
    var rhs = parse_term(ps);
    return Ctr("Cons", [lhs, rhs]);
  }
  return lhs;
}

// Parses numeric addition and subtraction.
function parse_add(ps: Parser): Term {
  var out = parse_mul(ps);
  while (true) {
    skip(ps);
    if (starts(ps, "+")) {
      ps.pos += 1;
      out = Add(out, parse_mul(ps));
      continue;
    }
    if (starts(ps, "-") && !/^[0-9]$/.test(peek_at(ps, 1))) {
      ps.pos += 1;
      out = Sub(out, parse_mul(ps));
      continue;
    }
    return out;
  }
}

// Parses numeric multiplication, integer division, and modulo.
function parse_mul(ps: Parser): Term {
  var out = parse_post(ps);
  while (true) {
    skip(ps);
    if (starts(ps, "*")) {
      ps.pos += 1;
      out = Mul(out, parse_post(ps));
      continue;
    }
    if (starts(ps, "/")) {
      ps.pos += 1;
      out = Div(out, parse_post(ps));
      continue;
    }
    if (starts(ps, "%")) {
      ps.pos += 1;
      out = Mod(out, parse_post(ps));
      continue;
    }
    return out;
  }
}

// Parses postfix function calls.
function parse_post(ps: Parser): Term {
  var out = parse_atom(ps);
  while (true) {
    skip(ps);
    if (!starts(ps, "(")) {
      return out;
    }
    ps.pos += 1;
    skip(ps);
    if (starts(ps, ")")) {
      ps.pos += 1;
      continue;
    }
    while (true) {
      var arg = parse_term(ps);
      out = App(out, arg);
      skip(ps);
      if (starts(ps, ",")) {
        ps.pos += 1;
        skip(ps);
      }
      if (starts(ps, ")")) {
        ps.pos += 1;
        break;
      }
    }
  }
}

// Parses an atomic term.
function parse_atom(ps: Parser): Term {
  skip(ps);
  var chr = peek(ps);
  if (chr === "λ") {
    ps.pos += 1;
    return parse_lam(ps);
  }
  if (chr === "!") {
    ps.pos += 1;
    return parse_let(ps);
  }
  if (chr === "&") {
    ps.pos += 1;
    return parse_sup(ps);
  }
  if (chr === "@") {
    ps.pos += 1;
    return Ref(parse_name(ps));
  }
  if (chr === "(") {
    ps.pos += 1;
    var trm = parse_term(ps);
    consume(ps, ")");
    return trm;
  }
  if (chr === "[") {
    return parse_list(ps);
  }
  if (/^[0-9]$/.test(chr) || (chr === "-" && /^[0-9]$/.test(peek_at(ps, 1)))) {
    return parse_num_or_nat(ps);
  }
  return Var(parse_name(ps));
}

// Parses a lambda or lambda-match body.
function parse_lam(ps: Parser): Term {
  skip(ps);
  if (starts(ps, "{")) {
    return parse_matcher(ps);
  }
  var nms: string[] = [];
  while (true) {
    skip(ps);
    if (starts(ps, "&")) {
      ps.pos += 1;
    }
    nms.push(parse_name(ps));
    skip(ps);
    if (starts(ps, ",")) {
      ps.pos += 1;
      continue;
    }
    consume(ps, ".");
    break;
  }
  var bod = parse_term(ps);
  for (var idx = nms.length - 1; idx >= 0; idx--) {
    bod = Lam(nms[idx], bod);
  }
  return bod;
}

// Parses a lambda-match term.
function parse_matcher(ps: Parser): Term {
  consume(ps, "{");
  var css: Case[] = [];
  while (true) {
    skip(ps);
    if (starts(ps, "}")) {
      ps.pos += 1;
      return Mat(css);
    }
    var cse = parse_case(ps);
    css.push(cse);
    skip(ps);
    if (starts(ps, ";")) {
      ps.pos += 1;
    }
  }
}

// Parses one match case.
function parse_case(ps: Parser): Case {
  skip(ps);
  if (starts(ps, "[]")) {
    ps.pos += 2;
    consume(ps, ":");
    return { $: "Ctr", nam: "Nil", bod: parse_term(ps) };
  }
  if (starts(ps, "<>")) {
    ps.pos += 2;
    consume(ps, ":");
    return { $: "Ctr", nam: "Cons", bod: parse_term(ps) };
  }
  var num = parse_digits(ps);
  if (starts(ps, "n")) {
    ps.pos += 1;
    if (num === 1 && starts(ps, "+")) {
      ps.pos += 1;
      consume(ps, ":");
      return { $: "Ctr", nam: "Succ", bod: parse_term(ps) };
    }
    if (num === 0) {
      consume(ps, ":");
      return { $: "Ctr", nam: "Zero", bod: parse_term(ps) };
    }
    throw new Error("unsupported nat match at byte " + ps.pos);
  }
  consume(ps, ":");
  return { $: "Num", val: num, bod: parse_term(ps) };
}

// Parses a non-empty digit sequence.
function parse_digits(ps: Parser): number {
  skip(ps);
  var beg = ps.pos;
  if (peek(ps) === "-" && /^[0-9]$/.test(peek_at(ps, 1))) {
    ps.pos += 1;
  }
  while (/^[0-9]$/.test(peek(ps))) {
    ps.pos += 1;
  }
  if (beg === ps.pos) {
    throw new Error("expected number at byte " + ps.pos);
  }
  return Number(ps.src.slice(beg, ps.pos));
}

// Parses let syntax.
function parse_let(ps: Parser): Term {
  skip(ps);
  if (starts(ps, "!")) {
    throw new Error("strict lets are outside SupVM's subset");
  }
  if (starts(ps, "&")) {
    ps.pos += 1;
  }
  var nam = parse_name(ps);
  skip(ps);
  if (starts(ps, "&")) {
    throw new Error("explicit DUP lets are outside SupVM's subset");
  }
  consume(ps, "=");
  var val = parse_term(ps);
  skip(ps);
  if (starts(ps, ";")) {
    ps.pos += 1;
  }
  var bod = parse_term(ps);
  return Let(nam, val, bod);
}

// Parses a superposition or eraser.
function parse_sup(ps: Parser): Term {
  skip(ps);
  if (starts(ps, "{}")) {
    ps.pos += 2;
    return Era();
  }
  var lab = parse_name(ps);
  skip(ps);
  var cap = 0;
  if (starts(ps, "[")) {
    cap = parse_sup_captures(ps);
  }
  consume(ps, "{");
  var lft = parse_term(ps);
  skip(ps);
  if (starts(ps, ";") || starts(ps, ",")) {
    ps.pos += 1;
  }
  var rgt = parse_term(ps);
  skip(ps);
  if (starts(ps, ";") || starts(ps, ",")) {
    ps.pos += 1;
  }
  consume(ps, "}");
  return Sup(lab, lft, rgt, cap);
}

// Parses and ignores sup-fork captures.
function parse_sup_captures(ps: Parser): number {
  consume(ps, "[");
  var cap = 0;
  while (true) {
    skip(ps);
    if (starts(ps, "]")) {
      ps.pos += 1;
      return cap;
    }
    if (starts(ps, "&")) {
      ps.pos += 1;
    }
    parse_name(ps);
    cap += 1;
    skip(ps);
    if (starts(ps, ",")) {
      ps.pos += 1;
    }
  }
}

// Parses a list literal.
function parse_list(ps: Parser): Term {
  consume(ps, "[");
  var els: Term[] = [];
  skip(ps);
  if (starts(ps, "]")) {
    ps.pos += 1;
    return Ctr("Nil", []);
  }
  while (true) {
    els.push(parse_term(ps));
    skip(ps);
    if (starts(ps, ",")) {
      ps.pos += 1;
      skip(ps);
    }
    if (starts(ps, "]")) {
      ps.pos += 1;
      break;
    }
  }
  var out = Ctr("Nil", []);
  for (var idx = els.length - 1; idx >= 0; idx--) {
    out = Ctr("Cons", [els[idx], out]);
  }
  return out;
}

// Parses a number or nat literal.
function parse_num_or_nat(ps: Parser): Term {
  var num = parse_digits(ps);
  if (!starts(ps, "n")) {
    return Num(num);
  }
  if (num < 0) {
    throw new Error("negative nat literal at byte " + ps.pos);
  }
  ps.pos += 1;
  var end: Term = Ctr("Zero", []);
  if (starts(ps, "+")) {
    ps.pos += 1;
    end = parse_term(ps);
  }
  for (var idx = 0; idx < num; idx++) {
    end = Ctr("Succ", [end]);
  }
  return end;
}

// Evaluation
// ==========

// Creates a runtime.
function runtime_new(book: Book): Runtime {
  return { book, itrs: 0, fresh: 0 };
}

// Increments the interaction counter.
function tick(rt: Runtime): void {
  rt.itrs += 1;
}

// Forces a suspension to weak-head normal form.
function force(rt: Runtime, chs: Choices, sus: Susp): Val {
  switch (sus.$) {
    case "Term": {
      return eval_term(rt, chs, sus.term, sus.env);
    }
    case "Val": {
      return eval_val(rt, chs, sus.val);
    }
    case "Add": {
      return eval_bin_num(rt, chs, sus.lft, sus.rgt, "Add");
    }
    case "Sub": {
      return eval_bin_num(rt, chs, sus.lft, sus.rgt, "Sub");
    }
    case "Mul": {
      return eval_bin_num(rt, chs, sus.lft, sus.rgt, "Mul");
    }
    case "Div": {
      return eval_bin_num(rt, chs, sus.lft, sus.rgt, "Div");
    }
    case "Mod": {
      return eval_bin_num(rt, chs, sus.lft, sus.rgt, "Mod");
    }
    case "App": {
      var fun = force(rt, chs, sus.fun);
      return apply_val(rt, chs, fun, sus.arg);
    }
    case "Eql": {
      return eval_eql(rt, chs, sus.lft, sus.rgt);
    }
    case "Leq": {
      return eval_leq(rt, chs, sus.lft, sus.rgt);
    }
    case "And": {
      return eval_and(rt, chs, sus.lft, sus.rgt);
    }
    case "Many": {
      return eval_many(rt, chs, sus.lft, sus.rgt, sus.idx);
    }
  }
}

// Resolves a value against already-made choices.
function eval_val(rt: Runtime, chs: Choices, val: Val): Val {
  if (val.$ === "Sup") {
    var pic = chs.get(val.lab);
    if (pic === 0) {
      return force(rt, chs, val.lft);
    }
    if (pic === 1) {
      return force(rt, chs, val.rgt);
    }
  }
  return val;
}

// Evaluates a term to weak-head normal form.
function eval_term(rt: Runtime, chs: Choices, trm: Term, env: Env): Val {
  switch (trm.$) {
    case "Var": {
      var got = env.get(trm.nam);
      if (got === undefined) {
        return { $: "Var", nam: trm.nam };
      }
      return force(rt, chs, got);
    }
    case "Ref": {
      var def = rt.book.get(trm.nam);
      if (def === undefined) {
        return { $: "Var", nam: "@" + trm.nam };
      }
      return eval_term(rt, chs, def, new Map());
    }
    case "Lam": {
      return { $: "Lam", nam: trm.nam, bod: trm.bod, env };
    }
    case "Mat": {
      return { $: "Mat", css: trm.css, env };
    }
    case "App": {
      var fun = force(rt, chs, Sterm(trm.fun, env));
      return apply_val(rt, chs, fun, Sterm(trm.arg, env));
    }
    case "Add": {
      return eval_bin_num(rt, chs, Sterm(trm.lft, env), Sterm(trm.rgt, env), "Add");
    }
    case "Sub": {
      return eval_bin_num(rt, chs, Sterm(trm.lft, env), Sterm(trm.rgt, env), "Sub");
    }
    case "Mul": {
      return eval_bin_num(rt, chs, Sterm(trm.lft, env), Sterm(trm.rgt, env), "Mul");
    }
    case "Div": {
      return eval_bin_num(rt, chs, Sterm(trm.lft, env), Sterm(trm.rgt, env), "Div");
    }
    case "Mod": {
      return eval_bin_num(rt, chs, Sterm(trm.lft, env), Sterm(trm.rgt, env), "Mod");
    }
    case "Let": {
      tick(rt);
      var nenv = new Map(env);
      nenv.set(trm.nam, Sterm(trm.val, env));
      return force(rt, chs, Sterm(trm.bod, nenv));
    }
    case "Sup": {
      rt.itrs += trm.cap;
      var pic = chs.get(trm.lab);
      if (pic === 0) {
        return force(rt, chs, Sterm(trm.lft, env));
      }
      if (pic === 1) {
        return force(rt, chs, Sterm(trm.rgt, env));
      }
      return { $: "Sup", lab: trm.lab, lft: Sterm(trm.lft, env), rgt: Sterm(trm.rgt, env) };
    }
    case "Era": {
      return { $: "Era" };
    }
    case "Num": {
      return { $: "Num", val: trm.val };
    }
    case "Ctr": {
      var fds = trm.fds.map(fld => Sterm(fld, env));
      return { $: "Ctr", nam: trm.nam, fds };
    }
    case "Eql": {
      return eval_eql(rt, chs, Sterm(trm.lft, env), Sterm(trm.rgt, env));
    }
    case "Leq": {
      return eval_leq(rt, chs, Sterm(trm.lft, env), Sterm(trm.rgt, env));
    }
    case "And": {
      return eval_and(rt, chs, Sterm(trm.lft, env), Sterm(trm.rgt, env));
    }
  }
}

// Applies a value to an argument suspension.
function apply_val(rt: Runtime, chs: Choices, fun: Val, arg: Susp): Val {
  fun = eval_val(rt, chs, fun);
  switch (fun.$) {
    case "Era": {
      return { $: "Era" };
    }
    case "Lam": {
      tick(rt);
      var nenv = new Map(fun.env);
      nenv.set(fun.nam, arg);
      return force(rt, chs, Sterm(fun.bod, nenv));
    }
    case "Mat": {
      return apply_mat(rt, chs, fun, arg);
    }
    case "Sup": {
      tick(rt);
      return { $: "Sup", lab: fun.lab, lft: Sapp(fun.lft, arg), rgt: Sapp(fun.rgt, arg) };
    }
    default: {
      return { $: "App", fun, arg };
    }
  }
}

// Applies a matcher to an argument.
function apply_mat(rt: Runtime, chs: Choices, mat: Val$Mat, arg: Susp): Val {
  var val = force(rt, chs, arg);
  val = eval_val(rt, chs, val);
  switch (val.$) {
    case "Era": {
      return { $: "Era" };
    }
    case "Sup": {
      tick(rt);
      var mvl: Val = mat;
      return { $: "Sup", lab: val.lab, lft: Sapp(Sval(mvl), val.lft), rgt: Sapp(Sval(mvl), val.rgt) };
    }
    case "Ctr": {
      return apply_mat_ctr(rt, chs, mat, val);
    }
    case "Num": {
      return apply_mat_num(rt, chs, mat, val);
    }
    default: {
      return { $: "App", fun: mat, arg: Sval(val) };
    }
  }
}

// Applies a matcher to a constructor.
function apply_mat_ctr(rt: Runtime, chs: Choices, mat: Val$Mat, ctr: Val$Ctr): Val {
  for (var idx = 0; idx < mat.css.length; idx++) {
    var cse = mat.css[idx];
    if (cse.$ !== "Ctr") {
      tick(rt);
      continue;
    }
    if (cse.nam !== ctr.nam) {
      tick(rt);
      continue;
    }
    tick(rt);
    var out: Susp = Sterm(cse.bod, mat.env);
    for (var f = 0; f < ctr.fds.length; f++) {
      out = Sapp(out, ctr.fds[f]);
    }
    return force(rt, chs, out);
  }
  return { $: "App", fun: mat, arg: Sval(ctr) };
}

// Applies a matcher to a number.
function apply_mat_num(rt: Runtime, chs: Choices, mat: Val$Mat, num: Val$Num): Val {
  for (var idx = 0; idx < mat.css.length; idx++) {
    var cse = mat.css[idx];
    if (cse.$ !== "Num") {
      tick(rt);
      continue;
    }
    if (cse.val !== num.val) {
      tick(rt);
      continue;
    }
    tick(rt);
    return force(rt, chs, Sterm(cse.bod, mat.env));
  }
  return { $: "App", fun: mat, arg: Sval(num) };
}

// Evaluates a structural equality.
function eval_eql(rt: Runtime, chs: Choices, lft: Susp, rgt: Susp): Val {
  var lfv = force(rt, chs, lft);
  lfv = eval_val(rt, chs, lfv);
  if (lfv.$ === "Era") {
    return { $: "Era" };
  }
  if (lfv.$ === "Sup") {
    tick(rt);
    return { $: "Sup", lab: lfv.lab, lft: Seql(lfv.lft, rgt), rgt: Seql(lfv.rgt, rgt) };
  }
  var rgv = force(rt, chs, rgt);
  rgv = eval_val(rt, chs, rgv);
  if (rgv.$ === "Era") {
    return { $: "Era" };
  }
  if (rgv.$ === "Sup") {
    tick(rt);
    return { $: "Sup", lab: rgv.lab, lft: Seql(lft, rgv.lft), rgt: Seql(lft, rgv.rgt) };
  }
  return eval_eql_val(rt, chs, lfv, rgv);
}

// Compares two weak-head values structurally.
function eval_eql_val(rt: Runtime, chs: Choices, lft: Val, rgt: Val): Val {
  if (lft.$ === "Num" && rgt.$ === "Num") {
    tick(rt);
    return { $: "Num", val: lft.val === rgt.val ? 1 : 0 };
  }
  if (lft.$ === "Ctr" && rgt.$ === "Ctr") {
    tick(rt);
    if (lft.nam !== rgt.nam || lft.fds.length !== rgt.fds.length) {
      return { $: "Num", val: 0 };
    }
    if (lft.fds.length === 0) {
      return { $: "Num", val: 1 };
    }
    return force(rt, chs, Smany(lft.fds, rgt.fds, 0));
  }
  if (lft.$ === "Var" && rgt.$ === "Var") {
    tick(rt);
    return { $: "Num", val: lft.nam === rgt.nam ? 1 : 0 };
  }
  tick(rt);
  return { $: "Num", val: 0 };
}

type BinOp = "Add" | "Sub" | "Mul" | "Div" | "Mod";

// Creates a numeric binary suspension.
function Sbin(op: BinOp, lft: Susp, rgt: Susp): Susp {
  switch (op) {
    case "Add": {
      return Sadd(lft, rgt);
    }
    case "Sub": {
      return Ssub(lft, rgt);
    }
    case "Mul": {
      return Smul(lft, rgt);
    }
    case "Div": {
      return Sdiv(lft, rgt);
    }
    case "Mod": {
      return Smod(lft, rgt);
    }
  }
}

// Applies a numeric binary operation.
function apply_bin_op(op: BinOp, lft: number, rgt: number): number {
  switch (op) {
    case "Add": {
      return lft + rgt;
    }
    case "Sub": {
      return lft - rgt;
    }
    case "Mul": {
      return lft * rgt;
    }
    case "Div": {
      if (rgt === 0) {
        return 0;
      }
      return Math.trunc(lft / rgt);
    }
    case "Mod": {
      if (rgt === 0) {
        return 0;
      }
      var out = lft % rgt;
      return out < 0 ? out + Math.abs(rgt) : out;
    }
  }
}

// Evaluates a numeric binary operation.
function eval_bin_num(rt: Runtime, chs: Choices, lft: Susp, rgt: Susp, op: BinOp): Val {
  var lfv = force(rt, chs, lft);
  lfv = eval_val(rt, chs, lfv);
  if (lfv.$ === "Era") {
    return { $: "Era" };
  }
  if (lfv.$ === "Sup") {
    tick(rt);
    return { $: "Sup", lab: lfv.lab, lft: Sbin(op, lfv.lft, rgt), rgt: Sbin(op, lfv.rgt, rgt) };
  }
  var rgv = force(rt, chs, rgt);
  rgv = eval_val(rt, chs, rgv);
  if (rgv.$ === "Era") {
    return { $: "Era" };
  }
  if (rgv.$ === "Sup") {
    tick(rt);
    return { $: "Sup", lab: rgv.lab, lft: Sbin(op, lft, rgv.lft), rgt: Sbin(op, lft, rgv.rgt) };
  }
  if (lfv.$ === "Num" && rgv.$ === "Num") {
    tick(rt);
    return { $: "Num", val: apply_bin_op(op, lfv.val, rgv.val) };
  }
  tick(rt);
  return { $: "Num", val: 0 };
}

// Evaluates a numeric less-than-or-equal comparison.
function eval_leq(rt: Runtime, chs: Choices, lft: Susp, rgt: Susp): Val {
  var lfv = force(rt, chs, lft);
  lfv = eval_val(rt, chs, lfv);
  if (lfv.$ === "Era") {
    return { $: "Era" };
  }
  if (lfv.$ === "Sup") {
    tick(rt);
    return { $: "Sup", lab: lfv.lab, lft: Sleq(lfv.lft, rgt), rgt: Sleq(lfv.rgt, rgt) };
  }
  var rgv = force(rt, chs, rgt);
  rgv = eval_val(rt, chs, rgv);
  if (rgv.$ === "Era") {
    return { $: "Era" };
  }
  if (rgv.$ === "Sup") {
    tick(rt);
    return { $: "Sup", lab: rgv.lab, lft: Sleq(lft, rgv.lft), rgt: Sleq(lft, rgv.rgt) };
  }
  if (lfv.$ === "Num" && rgv.$ === "Num") {
    tick(rt);
    return { $: "Num", val: lfv.val <= rgv.val ? 1 : 0 };
  }
  tick(rt);
  return { $: "Num", val: 0 };
}

// Evaluates a sequence of field equalities.
function eval_many(rt: Runtime, chs: Choices, lft: Susp[], rgt: Susp[], idx: number): Val {
  var pos = idx;
  while (pos < lft.length) {
    var cur = force(rt, chs, Seql(lft[pos], rgt[pos]));
    cur = eval_val(rt, chs, cur);
    if (cur.$ === "Era") {
      return cur;
    }
    if (cur.$ === "Sup") {
      var nxt = Smany(lft, rgt, pos + 1);
      return { $: "Sup", lab: cur.lab, lft: Sand(cur.lft, nxt), rgt: Sand(cur.rgt, nxt) };
    }
    if (cur.$ !== "Num") {
      tick(rt);
      return { $: "Num", val: 0 };
    }
    if (pos + 1 < lft.length) {
      tick(rt);
    }
    if (cur.val === 0) {
      return cur;
    }
    pos += 1;
  }
  return { $: "Num", val: 1 };
}

// Evaluates boolean and.
function eval_and(rt: Runtime, chs: Choices, lft: Susp, rgt: Susp): Val {
  var val = force(rt, chs, lft);
  val = eval_val(rt, chs, val);
  switch (val.$) {
    case "Era": {
      return val;
    }
    case "Sup": {
      tick(rt);
      return { $: "Sup", lab: val.lab, lft: Sand(val.lft, rgt), rgt: Sand(val.rgt, rgt) };
    }
    case "Num": {
      tick(rt);
      if (val.val === 0) {
        return { $: "Num", val: 0 };
      }
      return force(rt, chs, rgt);
    }
    default: {
      tick(rt);
      return { $: "Num", val: 0 };
    }
  }
}

// CNF / collapse
// ==============

// Maps a CNF result.
function cnf_map(cnf: Cnf, fnc: (val: Norm) => Norm): Cnf {
  switch (cnf.$) {
    case "Leaf": {
      return { $: "Leaf", val: fnc(cnf.val) };
    }
    case "Era": {
      return cnf;
    }
    case "Fork": {
      var lab = cnf.lab;
      var lft = cnf.lft;
      var rgt = cnf.rgt;
      return {
        $: "Fork",
        lab,
        lft: (rt, chs) => cnf_map(lft(rt, chs), fnc),
        rgt: (rt, chs) => cnf_map(rgt(rt, chs), fnc),
      };
    }
  }
}

// Binds a CNF result.
function cnf_bind(cnf: Cnf, fnc: (val: Norm) => Cnf): Cnf {
  switch (cnf.$) {
    case "Leaf": {
      return fnc(cnf.val);
    }
    case "Era": {
      return cnf;
    }
    case "Fork": {
      var lab = cnf.lab;
      var lft = cnf.lft;
      var rgt = cnf.rgt;
      return {
        $: "Fork",
        lab,
        lft: (rt, chs) => cnf_bind(lft(rt, chs), fnc),
        rgt: (rt, chs) => cnf_bind(rgt(rt, chs), fnc),
      };
    }
  }
}

// Converts a suspension to collapsed normal form, lifting one SUP.
function cnf_susp(rt: Runtime, chs: Choices, sus: Susp): Cnf {
  var val = force(rt, chs, sus);
  return cnf_val(rt, chs, val);
}

// Converts a value to collapsed normal form, lifting one SUP.
function cnf_val(rt: Runtime, chs: Choices, val: Val): Cnf {
  val = eval_val(rt, chs, val);
  switch (val.$) {
    case "Era": {
      return { $: "Era" };
    }
    case "Num": {
      return { $: "Leaf", val: NNum(val.val) };
    }
    case "Var": {
      return { $: "Leaf", val: NVar(val.nam) };
    }
    case "Sup": {
      var pic = chs.get(val.lab);
      if (pic === 0) {
        return cnf_susp(rt, chs, val.lft);
      }
      if (pic === 1) {
        return cnf_susp(rt, chs, val.rgt);
      }
      return {
        $: "Fork",
        lab: val.lab,
        lft: (nrt, nch) => cnf_susp(nrt, nch, val.lft),
        rgt: (nrt, nch) => cnf_susp(nrt, nch, val.rgt),
      };
    }
    case "Lam": {
      var nam = fresh_var(rt);
      var nenv = new Map(val.env);
      nenv.set(val.nam, Sval({ $: "Var", nam }));
      var bod = cnf_susp(rt, chs, Sterm(val.bod, nenv));
      return cnf_map(bod, out => NLam(nam, out));
    }
    case "Mat": {
      return cnf_cases(rt, chs, val.css, val.env, 0, []);
    }
    case "Ctr": {
      return cnf_fields(rt, chs, val.fds, 0, [], fds => NCtr(val.nam, fds));
    }
    case "App": {
      var fun = cnf_val(rt, chs, val.fun);
      return cnf_bind(fun, nfn => {
        var arg = cnf_susp(rt, chs, val.arg);
        return cnf_map(arg, nar => NApp(nfn, nar));
      });
    }
  }
}

// Normalizes match cases.
function cnf_cases(rt: Runtime, chs: Choices, css: Case[], env: Env, idx: number, acc: NormCase[]): Cnf {
  if (idx >= css.length) {
    return { $: "Leaf", val: NMat(acc) };
  }
  var cse = css[idx];
  var bod = cnf_susp(rt, chs, Sterm(cse.bod, env));
  return cnf_bind(bod, nbod => {
    var out = acc.slice();
    if (cse.$ === "Ctr") {
      out.push({ $: "Ctr", nam: cse.nam, bod: nbod });
    } else {
      out.push({ $: "Num", val: cse.val, bod: nbod });
    }
    return cnf_cases(rt, chs, css, env, idx + 1, out);
  });
}

// Normalizes a list of child suspensions.
function cnf_fields(rt: Runtime, chs: Choices, fds: Susp[], idx: number, acc: Norm[], fin: (fds: Norm[]) => Norm): Cnf {
  if (idx >= fds.length) {
    return { $: "Leaf", val: fin(acc) };
  }
  var fld = cnf_susp(rt, chs, fds[idx]);
  return cnf_bind(fld, nfd => {
    var out = acc.slice();
    out.push(nfd);
    return cnf_fields(rt, chs, fds, idx + 1, out, fin);
  });
}

// Creates a fresh internal variable name.
function fresh_var(rt: Runtime): string {
  var out = "$" + rt.fresh;
  rt.fresh += 1;
  return out;
}

// Copies a choice map and adds one choice.
function choice_ext(chs: Choices, lab: string, pic: Pick): Choices {
  var out = new Map(chs);
  out.set(lab, pic);
  return out;
}

// Runs collapse and returns the first leaf.
function collapse(rt: Runtime, root: Susp, lim: number): Norm | null {
  type Item = { job: Job, chs: Choices };
  var que: Item[] = [{ job: (nrt, nch) => cnf_susp(nrt, nch, root), chs: new Map() }];
  var pos = 0;
  var got = 0;
  while (pos < que.length) {
    var itm = que[pos++];
    var cnf = itm.job(rt, itm.chs);
    switch (cnf.$) {
      case "Era": {
        break;
      }
      case "Leaf": {
        got += 1;
        if (got >= lim) {
          return cnf.val;
        }
        break;
      }
      case "Fork": {
        que.push({ job: cnf.lft, chs: choice_ext(itm.chs, cnf.lab, 0) });
        que.push({ job: cnf.rgt, chs: choice_ext(itm.chs, cnf.lab, 1) });
        break;
      }
    }
  }
  return null;
}

// Pretty printer
// ==============

// Prints a base-26 alpha name.
function alpha_name(num: number, base: string): string {
  if (num <= 0) {
    return "_";
  }
  var chr = base.charCodeAt(0);
  var out = "";
  var cur = num;
  while (cur > 0) {
    cur -= 1;
    out = String.fromCharCode(chr + (cur % 26)) + out;
    cur = Math.floor(cur / 26);
  }
  return out;
}

// Prints a normal term.
function show_norm(trm: Norm): string {
  return show_go(trm, new Map(), 0);
}

// Prints a normal term recursively.
function show_go(trm: Norm, ctx: Map<string, string>, dep: number): string {
  switch (trm.$) {
    case "Var": {
      return ctx.get(trm.nam) || trm.nam;
    }
    case "Num": {
      return String(trm.val);
    }
    case "Lam": {
      var nam = alpha_name(dep + 1, "a");
      var nctx = new Map(ctx);
      nctx.set(trm.nam, nam);
      return "λ" + nam + "." + show_go(trm.bod, nctx, dep + 1);
    }
    case "Mat": {
      var buf = "λ{";
      for (var idx = 0; idx < trm.css.length; idx++) {
        if (idx > 0) {
          buf += ";";
        }
        var cse = trm.css[idx];
        buf += show_case_key(cse) + ":" + show_go(cse.bod, ctx, dep);
      }
      return buf + "}";
    }
    case "App": {
      return show_app(trm, ctx, dep);
    }
    case "Ctr": {
      return show_ctr(trm, ctx, dep);
    }
  }
}

// Prints an application spine.
function show_app(trm: Norm, ctx: Map<string, string>, dep: number): string {
  var args: Norm[] = [];
  var cur = trm;
  while (cur.$ === "App") {
    args.push(cur.arg);
    cur = cur.fun;
  }
  var out = show_go(cur, ctx, dep);
  if (cur.$ === "Lam") {
    out = "(" + out + ")";
  }
  out += "(";
  for (var idx = args.length - 1; idx >= 0; idx--) {
    if (idx !== args.length - 1) {
      out += ",";
    }
    out += show_go(args[idx], ctx, dep);
  }
  return out + ")";
}

// Prints a match key.
function show_case_key(cse: NormCase): string {
  if (cse.$ === "Num") {
    return String(cse.val);
  }
  switch (cse.nam) {
    case "Zero": {
      return "0n";
    }
    case "Succ": {
      return "1n+";
    }
    case "Nil": {
      return "[]";
    }
    case "Cons": {
      return "<>";
    }
    default: {
      return "#" + cse.nam;
    }
  }
}

// Prints a constructor.
function show_ctr(trm: Norm$Ctr, ctx: Map<string, string>, dep: number): string {
  var nat = nat_view(trm);
  if (nat !== null) {
    if (nat.rest === null) {
      return String(nat.num) + "n";
    }
    return String(nat.num) + "n+" + show_go(nat.rest, ctx, dep);
  }
  if (is_list_end(trm)) {
    return "[]";
  }
  if (trm.nam === "Cons") {
    var arr = list_view(trm);
    if (arr.end === null) {
      var out = "[";
      for (var idx = 0; idx < arr.items.length; idx++) {
        if (idx > 0) {
          out += ",";
        }
        out += show_go(arr.items[idx], ctx, dep);
      }
      return out + "]";
    }
    return show_go(trm.fds[0], ctx, dep) + "<>" + show_go(trm.fds[1], ctx, dep);
  }
  var buf = "#" + trm.nam + "{";
  for (var idx = 0; idx < trm.fds.length; idx++) {
    if (idx > 0) {
      buf += ",";
    }
    buf += show_go(trm.fds[idx], ctx, dep);
  }
  return buf + "}";
}

// Tests whether a constructor is nil.
function is_list_end(trm: Norm): boolean {
  return trm.$ === "Ctr" && trm.nam === "Nil" && trm.fds.length === 0;
}

// Views a proper or improper list.
function list_view(trm: Norm): { items: Norm[], end: Norm | null } {
  var cur = trm;
  var out: Norm[] = [];
  while (cur.$ === "Ctr" && cur.nam === "Cons" && cur.fds.length === 2) {
    out.push(cur.fds[0]);
    cur = cur.fds[1];
  }
  if (is_list_end(cur)) {
    return { items: out, end: null };
  }
  return { items: out, end: cur };
}

// Views a natural-number constructor.
function nat_view(trm: Norm): { num: number, rest: Norm | null } | null {
  var cur: Norm = trm;
  var num = 0;
  while (cur.$ === "Ctr" && cur.nam === "Succ" && cur.fds.length === 1) {
    num += 1;
    cur = cur.fds[0];
  }
  if (cur.$ === "Ctr" && cur.nam === "Zero" && cur.fds.length === 0) {
    return { num, rest: null };
  }
  if (num > 0) {
    return { num, rest: cur };
  }
  return null;
}

// CLI
// ===

// Parses command-line arguments.
function parse_args(argv: string[]): { file: string | null, collapse: number, stats: boolean, json: boolean } {
  var file: string | null = null;
  var col = 0;
  var sts = false;
  var json = false;
  for (var idx = 2; idx < argv.length; idx++) {
    var arg = argv[idx];
    if (arg === "-s" || arg === "--stats") {
      sts = true;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "-C" || arg === "--collapse") {
      idx += 1;
      col = Number(argv[idx] || "-1");
    } else if (arg.startsWith("-C")) {
      col = Number(arg.slice(2) || "-1");
    } else if (arg.startsWith("--collapse=")) {
      col = Number(arg.slice("--collapse=".length) || "-1");
    } else if (arg === "-h" || arg === "--help") {
      print_help();
      process.exit(0);
    } else if (!arg.startsWith("-")) {
      file = arg;
    }
  }
  return { file, collapse: col, stats: sts, json };
}

// Prints help.
function print_help(): void {
  console.log("Usage: node SupVM.ts <file.hvm> -C1 [-s] [--json]");
}

// Runs the command-line interface with a parsed config.
function run_cli(cfg: { file: string | null, collapse: number, stats: boolean, json: boolean }): { ok: boolean, valueText: string | null, interactions: number, elapsedMs: number, collapseRequested: number, timedOut: boolean, error: string | null } {
  var start = Date.now();
  if (cfg.file === null) {
    throw new Error("missing input file");
  }
  var src = fs.readFileSync(cfg.file, "utf8");
  var book = parse_program(src);
  var main = book.get("main");
  if (main === undefined) {
    throw new Error("missing @main definition");
  }
  var rt = runtime_new(book);
  var lim = cfg.collapse === 0 ? 1 : cfg.collapse;
  if (lim < 0) {
    lim = 1;
  }
  var got = collapse(rt, Sterm(Ref("main"), new Map()), lim);
  var valueText = got === null ? null : show_norm(got);
  return {
    ok: true,
    valueText,
    interactions: rt.itrs,
    elapsedMs: Date.now() - start,
    collapseRequested: cfg.collapse,
    timedOut: false,
    error: null,
  };
}

// Runs the command-line interface.
function main(): void {
  var cfg = parse_args(process.argv);
  if (cfg.file === null) {
    if (cfg.json) {
      console.log(JSON.stringify({
        ok: false,
        valueText: null,
        interactions: 0,
        elapsedMs: 0,
        collapseRequested: cfg.collapse,
        timedOut: false,
        error: "missing input file",
      }));
      process.exit(1);
    }
    print_help();
    process.exit(1);
  }
  try {
    var result = run_cli(cfg);
    if (cfg.json) {
      console.log(JSON.stringify(result));
      return;
    }
    if (result.valueText !== null) {
      console.log(result.valueText + " #" + result.interactions);
    }
    if (cfg.stats) {
      console.log("- Itrs: " + result.interactions + " interactions");
    }
  } catch (err) {
    if (cfg.json) {
      console.log(JSON.stringify({
        ok: false,
        valueText: null,
        interactions: 0,
        elapsedMs: 0,
        collapseRequested: cfg.collapse,
        timedOut: false,
        error: String((err && err.message) || err),
      }));
      process.exit(1);
    }
    throw err;
  }
}

// Runs the CLI entry point.
main();
