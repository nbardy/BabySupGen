import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./supgen-generic-ir.js", import.meta.url), "utf8");
const ir = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);

const {
  Term,
  Type,
  lowerDefinition,
  lowerProgram,
  lowerTerm,
  makeChoice,
  parseType,
  safeLabel,
  sameType,
  showType,
  sourceOf,
  uniqueItems,
} = ir;

assert.equal(showType(parseType("List<Int>")), "Int[]");
assert.equal(showType(parseType("(Int -> Bool)[]")), "(Int -> Bool)[]");
assert.equal(showType(parseType("Fun<Int, List<Bool>>")), "Int -> Bool[]");
assert.ok(sameType(parseType("List<Int>"), parseType("Int[]")));
assert.ok(!sameType(Type.list(Type.int()), Type.list(Type.bool())));

const cond = Term.prim("<=", [Term.var("x"), Term.int(3)]);
const branch = Term.if(cond, Term.bool(true), Term.bool(false));
assert.equal(sourceOf(branch), "if x <= 3 then true else false");
assert.equal(lowerTerm(branch), "λ{0:0; 1:1}(x <= 3)");

const matched = Term.match(Term.var("xs"), {
  "[]": Term.int(0),
  "<>": { params: ["head", "tail"], body: Term.prim("+", [Term.var("head"), Term.rec("loop", [Term.var("tail")])]) },
});
assert.equal(
  lowerTerm(matched),
  "λ{[]:0; <>:λhead,tail. head + @loop(tail)}(xs)",
);

const helperCall = Term.helper("combine", [Term.var("left"), Term.var("right")]);
assert.equal(sourceOf(helperCall), "combine(left,right)");
assert.equal(lowerTerm(helperCall), "@combine(left,right)");

const choice = makeChoice(" spaced label! ", [
  { term: Term.var("a") },
  { term: Term.var("a") },
  { term: Term.var("b") },
  { term: Term.var("c") },
]);
assert.equal(choice.label, "spaced_label_");
assert.equal(choice.term, "&spaced_label__0{a; &spaced_label__1{b; c}}");
assert.equal(choice.id, "&spaced_label__0{0; &spaced_label__1{1; 2}}");

assert.deepEqual(uniqueItems([{ key: "x", value: 1 }, { key: "x", value: 2 }, { key: "y", value: 3 }]), [
  { key: "x", value: 1 },
  { key: "y", value: 3 },
]);
assert.equal(safeLabel("123 !!!"), "choice");

assert.equal(lowerDefinition("id", Term.lambda("x", Term.var("x"))), "@id = λx. x");
assert.equal(
  lowerProgram([{ name: "id", term: Term.lambda("x", Term.var("x")) }], Term.call("id", [Term.int(7)])),
  "@id = λx. x\n@main = @id(7)\n",
);
