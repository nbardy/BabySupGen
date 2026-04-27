import assert from "node:assert/strict";

import { genericSupGenPresets } from "./generic-supgen-presets.js";
import { parseTinySpec } from "./tiny-supgen.js";
import { buildGenericSupGenSearch } from "./supgen-generic-search.js";
import {
  buildChoiceDimensions,
  buildFastSearchIR,
  decodeCandidateId,
  encodeChoiceVector,
  mixedRadixCandidateCount,
  selectKthSurvivor,
  summarizePlanStats,
} from "./fast-search-ir.js";

function presetSearch(name) {
  const preset = genericSupGenPresets[name];
  return buildGenericSupGenSearch(parseTinySpec(preset.spec), { depth: preset.depth });
}

function assertRoundTrip(dimensions, vectors) {
  for (const vector of vectors) {
    const candidateId = encodeChoiceVector(vector, dimensions);
    assert.notEqual(candidateId, null, `expected valid vector ${vector.join(",")}`);
    assert.deepEqual(decodeCandidateId(candidateId, dimensions), vector);
  }
}

const sortSearch = presetSearch("sort");
const sortPlan = buildFastSearchIR(sortSearch);
assert.equal(sortPlan.kind, "FastSearchIR");
assert.equal(sortPlan.engine, "BabySupGen");
assert.equal(sortPlan.canDecodeChoiceVector, true);
assert.deepEqual(
  sortPlan.dimensions.map((dimension) => dimension.arity),
  [1, 240, 240, 11, 240],
);
assert.equal(sortPlan.dimensions[0].name, "top-level generated plan");
assert.equal(sortPlan.dimensions[0].label, "top_level_generated_plan");
assert.equal(sortPlan.dimensions[1].label, "generic_ltl_struct_helper_nil");
assert.equal(sortPlan.dimensions[4].name, "generic structural cons case");
assert.equal(mixedRadixCandidateCount(sortPlan.dimensions), 152064000n);
assertRoundTrip(sortPlan.dimensions, [
  [0, 0, 0, 0, 0],
  [0, 1, 2, 3, 4],
  [0, 239, 239, 10, 239],
]);

const filterSearch = presetSearch("filterPrimes");
const filterDimensions = buildChoiceDimensions(filterSearch);
assert.deepEqual(
  filterDimensions.map((dimension) => dimension.arity),
  [2, 72, 35, 64, 2, 3, 1, 2, 11, 240, 240, 240, 11, 240],
);
assert.deepEqual(
  filterDimensions[0].options.map((option) => option.source),
  [
    "generic structural recursion with predicate helper",
    "generic structural recursion with list helper",
  ],
);
assert.equal(filterDimensions[1].name, "helper body: Int -> Bool");
assert.equal(filterDimensions[7].label, "generic_ltl_pred_aux_body_done");
assertRoundTrip(filterDimensions, [
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [1, 71, 34, 63, 1, 2, 0, 1, 10, 239, 239, 239, 10, 239],
  [1, 3, 5, 7, 1, 2, 0, 1, 4, 6, 8, 10, 5, 12],
]);

const flattenSearch = presetSearch("nestedFlatten");
const flattenStats = summarizePlanStats(flattenSearch);
assert.equal(flattenStats.choiceCount, 5);
assert.equal(flattenStats.optionCount, 732);
assert.equal(flattenStats.candidateCount, 152064000n);
assert.deepEqual(
  flattenStats.dimensions.map((dimension) => dimension.label),
  [
    "top_level_generated_plan",
    "generic_nested_helper_nil",
    "generic_nested_helper_cons",
    "generic_nested_target_nil",
    "generic_nested_target_cons",
  ],
);
assertRoundTrip(buildChoiceDimensions(flattenSearch), [
  [0, 0, 0, 0, 0],
  [0, 10, 20, 3, 40],
  [0, 239, 239, 10, 239],
]);

assert.deepEqual(decodeCandidateId(0n, sortPlan.dimensions), [0, 0, 0, 0, 0]);
assert.equal(encodeChoiceVector([1, 0, 0, 0, 0], sortPlan.dimensions), null);
assert.equal(decodeCandidateId(sortPlan.candidateCount, sortPlan.dimensions), null);
assert.equal(selectKthSurvivor([false, true, false, true, true], 0), 1);
assert.equal(selectKthSurvivor([false, true, false, true, true], 2), 4);
assert.equal(selectKthSurvivor(new Uint8Array([0, 1, 0, 1]), 1), 3);
assert.equal(selectKthSurvivor([false, true], 1), null);

console.log("fast-search-ir tests passed");
