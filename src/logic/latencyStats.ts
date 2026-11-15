/**
 * Latency instrumentation — pure, IO-free sample recorder.
 *
 * Each named metric keeps only its most recent `capacity` samples in a ring
 * buffer. Summaries report nearest-rank percentiles so slow outliers are
 * visible without retaining an unbounded history.
 */

export interface LatencySummary {
    count: number;
    p50: number;
    p95: number;
    max: number;
    last: number;
}

export interface LatencyRecorder {
    record(name: string, ms: number): void;
    summary(): Record<string, LatencySummary>;
    reset(): void;
}

interface SampleRing {
    values: number[];
    next: number;
    last: number;
}

function round1(value: number): number {
    return Math.round(value * 10) / 10;
}

export function createLatencyRecorder(capacity = 200): LatencyRecorder {
    const limit =
        typeof capacity === 'number' && Number.isFinite(capacity) && capacity > 0
            ? Math.floor(capacity)
            : 0;
    const rings = new Map<string, SampleRing>();

    function record(name: string, ms: number): void {
        if (limit === 0 || !Number.isFinite(ms) || ms < 0) return;
        let ring = rings.get(name);
        if (!ring) {
            ring = { values: [], next: 0, last: ms };
            rings.set(name, ring);
        }
        if (ring.values.length < limit) {
            ring.values.push(ms);
        } else {
            ring.values[ring.next] = ms;
            ring.next = (ring.next + 1) % limit;
        }
        ring.last = ms;
    }

    function summary(): Record<string, LatencySummary> {
        const result: Record<string, LatencySummary> = {};
        for (const [name, ring] of rings) {
            const n = ring.values.length;
            if (n === 0) continue;
            const sorted = [...ring.values].sort((a, b) => a - b);
            const percentile = (p: number): number => {
                // Nearest-rank percentile, clamped to the samples we kept.
                const index = Math.min(n - 1, Math.max(0, Math.ceil((p / 100) * n) - 1));
                return round1(sorted[index]);
            };
            result[name] = {
                count: n,
                p50: percentile(50),
                p95: percentile(95),
                max: round1(sorted[n - 1]),
                last: round1(ring.last),
            };
        }
        return result;
    }

    function reset(): void {
        rings.clear();
    }

    return { record, summary, reset };
}

/**
 * Run `fn`, record its elapsed milliseconds under `name`, and return/rethrow its
 * result. The sample is recorded on both resolve and reject.
 */
export async function timeAsync<T>(
    rec: LatencyRecorder,
    name: string,
    fn: () => Promise<T>,
    now: () => number = () => performance.now()
): Promise<T> {
    const start = now();
    try {
        return await fn();
    } finally {
        rec.record(name, now() - start);
    }
}
