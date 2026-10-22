const EXACT_PERCENTILE_LIMIT = 64;

class P2Quantile {
  constructor(probability) {
    this.p = probability;
    this.initial = [];
    this.q = new Array(5).fill(0);
    this.n = [1, 2, 3, 4, 5];
    this.np = [1, 1 + 2 * probability, 1 + 4 * probability, 3 + 2 * probability, 5];
    this.dn = [0, probability / 2, probability, (1 + probability) / 2, 1];
  }

  push(value) {
    if (!Number.isFinite(value)) return;
    if (this.initial.length < 5) {
      this.initial.push(value);
      if (this.initial.length === 5) {
        this.initial.sort((a, b) => a - b);
        this.q = [...this.initial];
      }
      return;
    }

    let k;
    if (value < this.q[0]) {
      this.q[0] = value;
      k = 0;
    } else if (value < this.q[1]) k = 0;
    else if (value < this.q[2]) k = 1;
    else if (value < this.q[3]) k = 2;
    else if (value <= this.q[4]) k = 3;
    else {
      this.q[4] = value;
      k = 3;
    }

    for (let i = k + 1; i < 5; i += 1) this.n[i] += 1;
    for (let i = 0; i < 5; i += 1) this.np[i] += this.dn[i];

    for (let i = 1; i <= 3; i += 1) {
      const d = this.np[i] - this.n[i];
      if ((d >= 1 && this.n[i + 1] - this.n[i] > 1) || (d <= -1 && this.n[i - 1] - this.n[i] < -1)) {
        const sign = Math.sign(d);
        const leftSpan = this.n[i] - this.n[i - 1];
        const rightSpan = this.n[i + 1] - this.n[i];
        const totalSpan = this.n[i + 1] - this.n[i - 1];
        const parabolic = this.q[i] + (sign / totalSpan) * (
          ((leftSpan + sign) * (this.q[i + 1] - this.q[i])) / rightSpan
          + ((rightSpan - sign) * (this.q[i] - this.q[i - 1])) / leftSpan
        );

        if (this.q[i - 1] < parabolic && parabolic < this.q[i + 1]) {
          this.q[i] = parabolic;
        } else {
          const neighbor = i + sign;
          this.q[i] += sign * (this.q[neighbor] - this.q[i]) / (this.n[neighbor] - this.n[i]);
        }
        this.n[i] += sign;
      }
    }
  }

  value() {
    if (this.initial.length === 0) return null;
    if (this.initial.length < 5) return exactPercentile(this.initial, this.p);
    return this.q[2];
  }
}

function exactPercentile(values, probability) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * probability;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  if (low === high) return sorted[low];
  const fraction = position - low;
  return sorted[low] * (1 - fraction) + sorted[high] * fraction;
}

export function createNumericStatistics() {
  return {
    count: 0,
    missingCount: 0,
    min: Infinity,
    max: -Infinity,
    mean: 0,
    exactSamples: [],
    p2Estimator: new P2Quantile(0.02),
    p98Estimator: new P2Quantile(0.98),
  };
}

export function pushNumericStatistic(state, value) {
  if (!Number.isFinite(value)) {
    state.missingCount += 1;
    return state;
  }
  state.count += 1;
  state.min = Math.min(state.min, value);
  state.max = Math.max(state.max, value);
  state.mean += (value - state.mean) / state.count;
  if (state.exactSamples.length < EXACT_PERCENTILE_LIMIT) state.exactSamples.push(value);
  state.p2Estimator.push(value);
  state.p98Estimator.push(value);
  return state;
}

export function finishNumericStatistics(state) {
  const useExact = state.count <= EXACT_PERCENTILE_LIMIT;
  return {
    count: state.count,
    missingCount: state.missingCount,
    min: state.count ? state.min : null,
    max: state.count ? state.max : null,
    mean: state.count ? state.mean : null,
    p2: state.count ? (useExact ? exactPercentile(state.exactSamples, 0.02) : state.p2Estimator.value()) : null,
    p98: state.count ? (useExact ? exactPercentile(state.exactSamples, 0.98) : state.p98Estimator.value()) : null,
  };
}

export function statisticsFromNumericValues(values) {
  const state = createNumericStatistics();
  for (const value of values) pushNumericStatistic(state, value);
  return finishNumericStatistics(state);
}

export function histogramFromNumericValues(values, binCount = 30) {
  let min = Infinity;
  let max = -Infinity;
  let count = 0;
  for (const raw of values || []) {
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    min = Math.min(min, value);
    max = Math.max(max, value);
    count += 1;
  }
  if (!count) return { bins: [], count: 0, min: null, max: null };
  if (min == max) return { bins: [{ x0: min, x1: max, count }], count, min, max };
  const binsN = Math.max(5, Math.min(80, Number(binCount) || 30));
  const width = (max - min) / binsN;
  const counts = new Uint32Array(binsN);
  for (const raw of values || []) {
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    const index = Math.min(binsN - 1, Math.max(0, Math.floor((value - min) / width)));
    counts[index] += 1;
  }
  return {
    bins: Array.from(counts, (binCountValue, index) => ({
      x0: min + index * width,
      x1: index === binsN - 1 ? max : min + (index + 1) * width,
      count: binCountValue,
    })),
    count, min, max,
  };
}

export { EXACT_PERCENTILE_LIMIT, exactPercentile };
