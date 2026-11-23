import { createLatencyRecorder, timeAsync } from './src/logic/latencyStats';

function ok(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('FAIL', msg);
    process.exitCode = 1;
  } else {
    console.log('ok', msg);
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)])
    );
  }
  return value;
}

function eq(actual: unknown, expected: unknown, msg: string): void {
  ok(
    JSON.stringify(canonical(actual)) === JSON.stringify(canonical(expected)),
    `${msg} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`
  );
}

function approx(actual: number, expected: number, msg: string): void {
  ok(actual === expected, `${msg} (expected ${expected}, got ${actual})`);
}

// --- empty summary ----------------------------------------------------------
const empty = createLatencyRecorder();
eq(empty.summary(), {}, 'empty recorder summary is {}');

// --- single sample ----------------------------------------------------------
const single = createLatencyRecorder();
single.record('one', 7);
eq(
  single.summary().one,
  { count: 1, p50: 7, p95: 7, max: 7, last: 7 },
  'single sample has count 1 with p50=p95=max=last'
);

// --- 1..100 percentiles -----------------------------------------------------
const hundred = createLatencyRecorder(100);
for (let i = 1; i <= 100; i++) hundred.record('hundred', i);
const h = hundred.summary().hundred;
eq(h, { count: 100, p50: 50, p95: 95, max: 100, last: 100 }, '1..100 gives p50 50, p95 95, max 100');
approx(h.p50, 50, 'p50 of 1..100 is 50');
approx(h.p95, 95, 'p95 of 1..100 is 95');
approx(h.max, 100, 'max of 1..100 is 100');

// --- capacity keeps only the newest samples ---------------------------------
const capped = createLatencyRecorder(10);
for (let i = 1; i <= 25; i++) capped.record('capped', i);
eq(
  capped.summary().capped,
  { count: 10, p50: 20, p95: 25, max: 25, last: 25 },
  'capacity 10 keeps only the last 10 samples'
);

// --- separate names are independent -----------------------------------------
const independent = createLatencyRecorder();
independent.record('a', 1);
independent.record('a', 3);
independent.record('b', 100);
const independentSummary = independent.summary();
eq(independentSummary.a, { count: 2, p50: 1, p95: 3, max: 3, last: 3 }, 'name a is tracked independently');
eq(independentSummary.b, { count: 1, p50: 100, p95: 100, max: 100, last: 100 }, 'name b is tracked independently');
ok(Object.keys(independentSummary).length === 2, 'only names with samples appear in the summary');

// --- invalid samples are ignored --------------------------------------------
const invalid = createLatencyRecorder();
invalid.record('bad', NaN);
invalid.record('bad', Infinity);
invalid.record('bad', -Infinity);
invalid.record('bad', -1);
eq(invalid.summary(), {}, 'NaN, Infinity, -Infinity and negative samples are ignored');
invalid.record('bad', 2.26);
invalid.record('bad', -5);
invalid.record('bad', Number.NaN);
eq(
  invalid.summary().bad,
  { count: 1, p50: 2.3, p95: 2.3, max: 2.3, last: 2.3 },
  'valid samples survive alongside ignored invalid samples'
);

// --- rounding to one decimal ------------------------------------------------
const rounding = createLatencyRecorder();
rounding.record('round', 1.26);
eq(
  rounding.summary().round,
  { count: 1, p50: 1.3, p95: 1.3, max: 1.3, last: 1.3 },
  'values round to one decimal (1.26 -> 1.3)'
);
const roundingMany = createLatencyRecorder();
roundingMany.record('round', 1.24);
roundingMany.record('round', 1.26);
eq(
  roundingMany.summary().round,
  { count: 2, p50: 1.2, p95: 1.3, max: 1.3, last: 1.3 },
  'percentiles, max and last all round to one decimal'
);

// --- reset clears everything ------------------------------------------------
const resettable = createLatencyRecorder();
resettable.record('x', 1);
resettable.record('y', 2);
resettable.reset();
eq(resettable.summary(), {}, 'reset clears all names and samples');

// --- timeAsync: resolving fn with an injected clock -------------------------
async function testTimeAsync(): Promise<void> {
  let clock = 100;
  const resolving = createLatencyRecorder();
  const value = await timeAsync(
    resolving,
    'resolved',
    async () => {
      clock += 12.34;
      return 'value';
    },
    () => clock
  );
  ok(value === 'value', 'timeAsync returns the resolved value');
  eq(
    resolving.summary().resolved,
    { count: 1, p50: 12.3, p95: 12.3, max: 12.3, last: 12.3 },
    'timeAsync records elapsed ms for a resolving fn'
  );

  // --- timeAsync: rejecting fn records elapsed ms and rethrows ---------------
  let rejectClock = 0;
  const rejecting = createLatencyRecorder();
  let thrown: unknown = null;
  try {
    await timeAsync(
      rejecting,
      'rejected',
      async () => {
        rejectClock += 5.5;
        throw new Error('boom');
      },
      () => rejectClock
    );
  } catch (err) {
    thrown = err;
  }
  ok(thrown instanceof Error && thrown.message === 'boom', 'timeAsync rethrows the rejection');
  eq(
    rejecting.summary().rejected,
    { count: 1, p50: 5.5, p95: 5.5, max: 5.5, last: 5.5 },
    'timeAsync records elapsed ms for a rejecting fn'
  );
}

testTimeAsync()
  .catch((err) => {
    console.error('FAIL timeAsync test crashed', err);
    process.exitCode = 1;
  })
  .finally(() => {
    if (!process.exitCode) console.log('verify:latency-stats ok');
  });
