import assert from "node:assert/strict";

import { genericSupGenPresets } from "./generic-supgen-presets.js";
import { runCompiledSearch } from "./compiled-search-runtime.js";
import { buildTinySearch, parseTinySpec, tinyPresets } from "./tiny-supgen.js";
import { buildGenericSupGenSearch } from "./supgen-generic-search.js";

function searchFor(name) {
  const preset = genericSupGenPresets[name];
  return buildGenericSupGenSearch(parseTinySpec(preset.spec), {
    depth: preset.depth,
    dialect: "library",
  });
}

function vectorFrom(result) {
  const match = result.stdout.match(/^\[([^\]]*)\]/);
  assert.ok(match, `missing vector in ${result.stdout || result.stderr}`);
  return match[1]
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item));
}

const incSearch = buildGenericSupGenSearch(
  {
    target: { name: "inc", args: [{ name: "x", type: "Int" }], ret: "Int" },
    helpers: [],
    assertions: [
      { fn: "inc", args: ["0"], expected: "1" },
      { fn: "inc", args: ["1"], expected: "2" },
    ],
    ensures: [],
  },
  { depth: 1 },
);
const inc = await runCompiledSearch(incSearch);
assert.equal(inc.ok, true);
assert.match(incSearch.decodeChoiceVector(vectorFrom(inc)), /return x (?:\+ 1|- -1)/);

const tinyNatIncSearch = buildTinySearch(tinyPresets.natInc.spec, { depth: tinyPresets.natInc.depth });
assert.equal(tinyNatIncSearch.mode, "candidateId");
assert.equal(tinyNatIncSearch.variantPlans.length, 1);
const tinyNatInc = await runCompiledSearch(tinyNatIncSearch);
assert.equal(tinyNatInc.ok, true);
assert.match(tinyNatInc.stdout, /^4 #/);
assert.match(tinyNatIncSearch.candidates[4].source, /1n\+\(x\)/);

const sortSearch = searchFor("sort");
const sort = await runCompiledSearch(sortSearch);
assert.equal(sort.ok, true);
assert.deepEqual(vectorFrom(sort), [0, 0, 0, 0, 0]);
assert.match(sortSearch.decodeChoiceVector(vectorFrom(sort)), /insert\(x, sort\(rest\)\)/);

const primesSearch = searchFor("filterPrimes");
const primes = await runCompiledSearch(primesSearch);
assert.equal(primes.ok, true);
assert.match(primesSearch.decodeChoiceVector(vectorFrom(primes)), /n % d == 0/);
assert.match(primesSearch.decodeChoiceVector(vectorFrom(primes)), /predAux\(2, p\)/);

const selectorPairSearch = searchFor("largestPrimeSmallestEven");
const selectorPair = await runCompiledSearch(selectorPairSearch, { timeoutMs: 60_000 });
assert.equal(selectorPair.ok, true);
assert.match(selectorPairSearch.decodeChoiceVector(vectorFrom(selectorPair)), /def isPrimeLikeAux\(d: Int, n: Int\) -> Bool:/);
assert.match(selectorPairSearch.decodeChoiceVector(vectorFrom(selectorPair)), /n % d == 0/);
assert.match(selectorPairSearch.decodeChoiceVector(vectorFrom(selectorPair)), /def isEvenLike\(p: Int\) -> Bool:/);
assert.match(selectorPairSearch.decodeChoiceVector(vectorFrom(selectorPair)), /p % 2 == 0/);
assert.match(selectorPairSearch.decodeChoiceVector(vectorFrom(selectorPair)), /return \[pickPrime\(xs\), pickEven\(xs\)\]/);

const minEvenSearch = searchFor("minEven");
const minEven = await runCompiledSearch(minEvenSearch);
assert.equal(minEven.ok, true);
assert.match(minEvenSearch.decodeChoiceVector(vectorFrom(minEven)), /p % 2 == 0/);

const flattenSearch = searchFor("nestedFlatten");
const flatten = await runCompiledSearch(flattenSearch);
assert.equal(flatten.ok, true);
assert.match(flattenSearch.decodeChoiceVector(vectorFrom(flatten)), /append\(xs, flatten\(rest\)\)/);

console.log("compiled-search-runtime tests passed");
