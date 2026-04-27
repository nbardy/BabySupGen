function asDimensions(input) {
  if (Array.isArray(input)) {
    return input;
  }
  if (Array.isArray(input?.dimensions)) {
    return input.dimensions;
  }
  return buildChoiceDimensions(input);
}

function choiceArity(choice) {
  if (Number.isInteger(choice?.arity)) {
    return choice.arity;
  }
  if (Array.isArray(choice?.items)) {
    return choice.items.length;
  }
  if (Array.isArray(choice?.options)) {
    return choice.options.length;
  }
  throw new Error(`choice dimension is missing items/options: ${choice?.name || choice?.label || "unknown"}`);
}

function safeLabel(value, fallback) {
  const text = String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9_$]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!text || !/^[A-Za-z_$]/.test(text)) {
    return fallback;
  }
  return text;
}

function normalizeOption(item, index) {
  return {
    index,
    source: item?.source ?? item?.term ?? String(index),
    term: item?.term ?? item?.source ?? String(index),
  };
}

function toBigIntId(value, name = "candidate id") {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number" && Number.isInteger(value)) {
    return BigInt(value);
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return BigInt(value);
  }
  throw new Error(`${name} must be an integer`);
}

function safeNumber(value) {
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
}

export function buildChoiceDimensions(search) {
  if (!Array.isArray(search?.choices)) {
    throw new Error("FastSearchIR requires a search object with a choices array");
  }
  return search.choices.map((choice, index) => {
    const arity = choiceArity(choice);
    if (arity < 1) {
      throw new Error(`choice dimension ${index} has no options`);
    }
    const name = choice?.name || choice?.label || `choice ${index}`;
    return {
      id: index,
      label: choice?.label || safeLabel(name, `choice_${index}`),
      name,
      arity,
      options: Array.from(choice?.items || choice?.options || [], normalizeOption),
    };
  });
}

export function mixedRadixStrides(dimensions) {
  let stride = 1n;
  return asDimensions(dimensions).map((dimension) => {
    const current = stride;
    stride *= BigInt(choiceArity(dimension));
    return current;
  });
}

export function mixedRadixCandidateCount(dimensions) {
  return asDimensions(dimensions).reduce((count, dimension) => count * BigInt(choiceArity(dimension)), 1n);
}

export function decodeCandidateId(candidateId, dimensions) {
  const dims = asDimensions(dimensions);
  let rest = toBigIntId(candidateId);
  const total = mixedRadixCandidateCount(dims);
  if (rest < 0n || rest >= total) {
    return null;
  }
  return dims.map((dimension) => {
    const radix = BigInt(choiceArity(dimension));
    const value = Number(rest % radix);
    rest /= radix;
    return value;
  });
}

export function encodeChoiceVector(vector, dimensions) {
  const dims = asDimensions(dimensions);
  if (!Array.isArray(vector) || vector.length !== dims.length) {
    return null;
  }
  let stride = 1n;
  let candidateId = 0n;
  for (let index = 0; index < dims.length; index += 1) {
    const value = vector[index];
    const arity = choiceArity(dims[index]);
    if (!Number.isInteger(value) || value < 0 || value >= arity) {
      return null;
    }
    candidateId += BigInt(value) * stride;
    stride *= BigInt(arity);
  }
  return candidateId;
}

export function selectKthSurvivor(alive, kth) {
  if (!Array.isArray(alive) && !ArrayBuffer.isView(alive)) {
    throw new Error("alive must be an array or typed array");
  }
  let remaining = Number(kth);
  if (!Number.isInteger(remaining) || remaining < 0) {
    throw new Error("kth must be a non-negative integer");
  }
  for (let index = 0; index < alive.length; index += 1) {
    if (!alive[index]) {
      continue;
    }
    if (remaining === 0) {
      return index;
    }
    remaining -= 1;
  }
  return null;
}

export function summarizePlanStats(searchOrPlan) {
  const dimensions = asDimensions(searchOrPlan);
  const arities = dimensions.map(choiceArity);
  const candidateCount = mixedRadixCandidateCount(dimensions);
  const maxArity = arities.length ? Math.max(...arities) : 0;
  const minArity = arities.length ? Math.min(...arities) : 0;
  return {
    choiceCount: dimensions.length,
    optionCount: arities.reduce((sum, arity) => sum + arity, 0),
    candidateCount,
    candidateCountText: candidateCount.toString(),
    candidateCountNumber: safeNumber(candidateCount),
    minArity,
    maxArity,
    dimensions: dimensions.map(({ id, label, name, arity }) => ({ id, label, name, arity })),
  };
}

export function buildFastSearchIR(search) {
  const dimensions = buildChoiceDimensions(search);
  const candidateCount = mixedRadixCandidateCount(dimensions);
  return {
    kind: "FastSearchIR",
    engine: search.engine,
    mode: search.mode,
    dimensions,
    strides: mixedRadixStrides(dimensions),
    candidateCount,
    candidateCountText: candidateCount.toString(),
    candidateCountNumber: safeNumber(candidateCount),
    assertions: Array.isArray(search.assertions) ? search.assertions : [],
    canDecodeChoiceVector: typeof search.decodeChoiceVector === "function",
  };
}
