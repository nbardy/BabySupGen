export const genericSupGenPresets = {
  minEven: {
    title: "Minimum even integer",
    depth: 4,
    spec: `def pred = ?
def minEven(xs: Int[]) -> Int: ?

assert minEven([5,4,8,3]) == 4
assert minEven([9,2,6]) == 2
assert minEven([7,11,14]) == 14
ensure selects(xs, minEven(xs))
ensure pred(minEven(xs))
`,
  },
  maxSquareMinusMin: {
    title: "Max square minus minimum",
    depth: 4,
    spec: `def aux = ?
def score(xs: Int[]) -> Int: ?

assert score([3,1,2]) == 8
assert score([1,3,2]) == 8
assert score([5,-1,5,0]) == 26
assert score([2,1]) == 3
ensure aggregate(xs)
`,
  },
  sort: {
    title: "Structural integer sort",
    depth: 4,
    spec: `def insert = ?
def sort(xs: Int[]) -> Int[]: ?

assert sort([3,1,2]) == [1,2,3]
assert sort([5,-1,5,0]) == [-1,0,5,5]
assert sort([2,1]) == [1,2]
ensure sorted(sort(xs))
ensure permutation(sort(xs), xs)
`,
  },
  filterPrimes: {
    title: "Filter primes",
    depth: 4,
    spec: `def pred = ?
def primes(xs: Int[]) -> Int[]: ?

assert primes([1,2,3,4,5,6,7,8,9,10,11]) == [2,3,5,7,11]
assert primes([-1,0,1,2,4,13]) == [2,13]
assert primes([8,9,10,12]) == []
`,
  },
  nestedFlatten: {
    title: "Nested list flatten",
    depth: 4,
    spec: `def append = ?
def flatten(xss: Int[][]) -> Int[]: ?

assert flatten([[1,2],[3],[]]) == [1,2,3]
assert flatten([[],[-1,0],[5]]) == [-1,0,5]
assert flatten([]) == []
ensure concat_order(flatten(xss), xss)
`,
  },
};
