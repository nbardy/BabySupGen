import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./object-language-generator-ir.js", import.meta.url), "utf8");
const ir = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);

const {
  Ctx,
  Path,
  Source,
  Type,
  assertSmallerCall,
  canMakeSmallerCall,
  forkLabel,
  forkLabels,
  genTermDirect,
  helperTypeRecord,
  isStructurallySmaller,
  printSource,
  sameType,
  serializeCtxBinding,
  serializeGenerated,
  serializeHelperType,
  serializePath,
  serializeSource,
  serializeType,
} = ir;

assert.equal(forkLabel("root", "if", "cond"), "root_if_cond");
assert.equal(forkLabel("root", "if", "cond"), forkLabel("root", "if", "cond"));
assert.deepEqual(forkLabels("root", "if", ["cond", "yes", "no"]), [
  "root_if_cond",
  "root_if_yes",
  "root_if_no",
]);
assert.equal(new Set(forkLabels("root", "if", ["cond", "yes", "no"])).size, 3);

const intCtx = Ctx.from([Ctx.binding("x", Type.int())]);
assert.equal(
  serializeCtxBinding(Ctx.binding("x", Type.int())),
  '#CBinding{name:"x",type:#TInt,value:#SVar{name:"x"},smallerThan:null,restricted:null}',
);
const intAtoms = genTermDirect(Type.int(), intCtx, { label: "root atom", intLiterals: [7] });
assert.equal(intAtoms.length, 2);
assert.deepEqual(intAtoms[0], {
  tag: "Gen",
  type: Type.int(),
  source: Source.var("x"),
  value: "x",
  path: Path.cons("root_atom", 0),
});
assert.equal(printSource(intAtoms[1].source), "7");
assert.equal(intAtoms[1].value, "7");
assert.equal(serializePath(intAtoms[1].path), '#PCons{label:"root_atom",index:1,tail:#PNil}');
assert.equal(
  serializeGenerated(intAtoms[1]),
  '#Gen{type:#TInt,source:#SLitInt{value:7},value:7,path:#PCons{label:"root_atom",index:1,tail:#PNil}}',
);

const boolAtoms = genTermDirect(Type.bool(), Ctx.nil(), { label: "bool atom", boolLiterals: [false, true] });
assert.equal(printSource(boolAtoms[1].source), "true");
assert.equal(boolAtoms[1].value, "1");
assert.equal(serializeSource(boolAtoms[1].source), "#SLitBool{value:true}");
assert.equal(serializePath(boolAtoms[1].path), '#PCons{label:"bool_atom",index:1,tail:#PNil}');

const auxType = Type.fun(Type.int(), Type.bool());
const auxRecord = helperTypeRecord("aux", auxType, { label: "aux type!", index: 2 });
assert.equal(auxRecord.tag, "HelperType");
assert.equal(auxRecord.name, "aux");
assert.ok(sameType(auxRecord.type, auxType));
assert.equal(auxRecord.label, "aux_type_");
assert.equal(auxRecord.bodyLabel, "aux_type__body_0");
assert.equal(auxRecord.targetLabel, "aux_type__target_0");
assert.equal(serializeType(auxRecord.type), "#TFun{arg:#TInt,ret:#TBool}");
assert.equal(
  serializeHelperType(auxRecord),
  '#HelperType{name:"aux",type:#TFun{arg:#TInt,ret:#TBool},label:"aux_type_",path:#PCons{label:"aux_type_",index:2,tail:#PNil},bodyLabel:"aux_type__body_0",targetLabel:"aux_type__target_0"}',
);

const intList = Type.list(Type.int());
const structuralCtx = Ctx.from([
  Ctx.binding("xs", intList),
  Ctx.binding("rest", intList, Source.var("rest"), { smallerThan: "xs" }),
  Ctx.binding("rest2", intList, Source.var("rest2"), { smallerThan: "rest" }),
]);
assert.equal(isStructurallySmaller(structuralCtx, "rest", "xs"), true);
assert.equal(isStructurallySmaller(structuralCtx, "rest2", "xs"), true);
assert.equal(isStructurallySmaller(structuralCtx, "xs", "xs"), false);
assert.equal(canMakeSmallerCall(structuralCtx, ["rest"], { baseName: "xs", structuralArgIndex: 0 }), true);
assert.equal(canMakeSmallerCall(structuralCtx, ["xs"], { baseName: "xs", structuralArgIndex: 0 }), false);
assert.equal(assertSmallerCall(structuralCtx, ["rest"], { baseName: "xs", structuralArgIndex: 0 }), true);
assert.throws(
  () => assertSmallerCall(structuralCtx, ["xs"], { baseName: "xs", structuralArgIndex: 0 }),
  /structurally smaller argument than xs: xs/,
);

console.log("object-language-generator-ir tests passed");
