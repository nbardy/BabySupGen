import assert from "node:assert/strict";

import { genericSupGenPresets } from "./generic-supgen-presets.js";
import { parseTinySpec } from "./tiny-supgen.js";
import { parseType, sameType, showType } from "./supgen-generic-ir.js";
import { buildGenericSupGenSearch, genType, genericSearchDialects } from "./supgen-generic-search.js";

const incSearch = buildGenericSupGenSearch(
  {
    target: { name: "inc", args: [{ name: "x", type: "Int" }], ret: "Int" },
    helpers: [],
    assertions: [{ fn: "inc", args: ["1"], expected: "2" }],
    ensures: [],
  },
  { depth: 1 },
);

assert.equal(incSearch.engine, "BabySupGen");
assert.equal(incSearch.mode, "choiceVector");
assert.match(incSearch.program, /@inc = λx\./);
assert.ok(incSearch.choices.some((choice) => choice.items.some((item) => item.source === "x + 1")));
assert.match(incSearch.decodeChoiceVector([1]), /def inc\(x: Int\) -> Int:/);

const nestedSpec = parseTinySpec(genericSupGenPresets.nestedFlatten.spec);
const helperTypes = genType(nestedSpec).map(showType);
assert.ok(helperTypes.includes("Int[] -> Int[] -> Int[]"));
assert.ok(sameType(parseType("List<Int>"), parseType("Int[]")));

const sortSearch = buildGenericSupGenSearch(parseTinySpec(genericSupGenPresets.sort.spec), { depth: 4 });
assert.equal(sortSearch.dialect, "library");
assert.equal(genericSearchDialects.minimal.label, "Minimal core");
assert.deepEqual(
  sortSearch.choices[0].items.map((item) => item.source),
  ["generic structural recursion with list helper"],
);
assert.match(sortSearch.decodeChoiceVector([0, 0, 0, 0, 0]), /def sort\(xs: Int\[\]\) -> Int\[\]:/);
assert.match(sortSearch.decodeChoiceVector([0, 0, 0, 0, 0]), /insert\(x, sort\(rest\)\)/);

const filterSearch = buildGenericSupGenSearch(parseTinySpec(genericSupGenPresets.filterPrimes.spec), { depth: 4 });
assert.deepEqual(
  filterSearch.choices[0].items.map((item) => item.source),
  [
    "generic structural recursion with predicate helper",
    "generic structural recursion with list helper",
  ],
);
assert.ok(!filterSearch.choices[0].items.some((item) => /filter|sort/.test(item.source)));

const selectorPairSpec = parseTinySpec(genericSupGenPresets.largestPrimeSmallestEven.spec);
assert.deepEqual(
  selectorPairSpec.helpers.map((helper) => [helper.name, helper.typed, helper.ret]),
  [
    ["pickPrime", true, "Int"],
    ["pickEven", true, "Int"],
    ["isPrimeLike", true, "Bool"],
    ["isEvenLike", true, "Bool"],
  ],
);
const selectorPairSearch = buildGenericSupGenSearch(selectorPairSpec, { depth: 4 });
assert.deepEqual(
  selectorPairSearch.choices[0].items.map((item) => item.source),
  [
    "selector pair list output",
    "generic structural recursion with predicate helper",
    "generic structural recursion with list helper",
  ],
);
assert.match(selectorPairSearch.decodeChoiceVector([0, 44, 7, 26, 0, 0, 0, 0, 37, 0, 0, 0, 0, 0, 0, 1, 0, 0]), /def pickPrime\(xs: Int\[\]\) -> Int:/);

const minimalSortSearch = buildGenericSupGenSearch(parseTinySpec(genericSupGenPresets.sort.spec), {
  depth: 4,
  dialect: "minimal",
});
assert.equal(minimalSortSearch.dialect, "minimal");
assert.match(minimalSortSearch.program, /Library filter\/insert shortcuts are disabled/);
assert.ok(!minimalSortSearch.program.includes("focused"));
assert.ok(!minimalSortSearch.program.includes("@__generic_filtered"));
assert.ok(!minimalSortSearch.program.includes("@__generic_state"));
assert.ok(
  minimalSortSearch.choices[2].items.some((item) => item.source === "x <> insert(x, ys)"),
  "minimal helper still gets recursive helper calls from the generic term grammar",
);
assert.ok(
  minimalSortSearch.choices[4].items.some((item) => item.source === "insert(x, sort(rest))"),
  "minimal target still gets helper calls from the generic term grammar",
);

const minimalAggregateSearch = buildGenericSupGenSearch(parseTinySpec(genericSupGenPresets.maxSquareMinusMin.spec), {
  depth: 4,
  dialect: "minimal",
});
assert.deepEqual(
  minimalAggregateSearch.choices[0].items.map((item) => item.source),
  ["generic structural list recursion", "structural Int recursion"],
);
assert.ok(!minimalAggregateSearch.program.includes("@__generic_state"));

const flattenSearch = buildGenericSupGenSearch(nestedSpec, { depth: 4 });
assert.deepEqual(
  flattenSearch.choices[0].items.map((item) => item.source),
  ["generic structural nested-list recursion"],
);
assert.match(flattenSearch.decodeChoiceVector([0, 0, 0, 0, 0]), /append\(xs, flatten\(rest\)\)/);

console.log("supgen-generic-search tests passed");
