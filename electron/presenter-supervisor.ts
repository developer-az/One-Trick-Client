// Pure, clock-injected supervisor for the native overlay presenter.
//
// The caller owns spawning, timers and the pipe. This module only decides
// whether the presenter should be respawned, whether the backoff has not
// elapsed yet, or whether it is time to fall back to the Electron overlay.
// It never reads Date.now(), so the same call sequence always produces the
// same decisions.

export type SupervisorAction =
    | { kind: 'none' }
    | { kind: 'respawn'; attempt: number }
    | { kind: 'wait'; untilMs: number }
    | { kind: 'fallback'; reason: string };

export interface SupervisorOptions {
    /** Delay after the Nth consecutive failure. */
    backoffMs?: number[];
    /** Failures inside failureWindowMs that trigger a fallback. */
    maxFailuresInWindow?: number;
    /** Sliding window used for the fallback decision. */
    failureWindowMs?: number;
    /** Sustained health needed to forgive earlier consecutive failures. */
    healthyResetMs?: number;
}

const DEFAULT_BACKOFF_MS = [1000, 2000, 4000, 8000];
const DEFAULT_MAX_FAILURES_IN_WINDOW = 4;
const DEFAULT_FAILURE_WINDOW_MS = 60_000;
const DEFAULT_HEALTHY_RESET_MS = 120_000;

export class PresenterSupervisor {
    private readonly backoffMs: number[];
    private readonly maxFailuresInWindow: number;
    private readonly failureWindowMs: number;
    private readonly healthyResetMs: number;

    private inFlight = false;
    private healthySince: number | null = null;
    private failureTimes: number[] = [];
    private nextAllowedAt = 0;
    private respawns = 0;
    private fellBack = false;
    private lastReason: string | null = null;

    constructor(options: SupervisorOptions = {}) {
        const backoff = options.backoffMs;
        this.backoffMs =
            backoff && backoff.length > 0 ? [...backoff] : [...DEFAULT_BACKOFF_MS];
        this.maxFailuresInWindow =
            options.maxFailuresInWindow ?? DEFAULT_MAX_FAILURES_IN_WINDOW;
        this.failureWindowMs = options.failureWindowMs ?? DEFAULT_FAILURE_WINDOW_MS;
        this.healthyResetMs = options.healthyResetMs ?? DEFAULT_HEALTHY_RESET_MS;
    }

    /** A spawn attempt began; block further respawns until it settles. */
    noteStarting(now: number): void {
        void now;
        this.inFlight = true;
        this.healthySince = null;
        this.respawns += 1;
    }

    /** The handshake finished. This does not forgive earlier failures by itself. */
    noteReady(now: number): void {
        this.inFlight = false;
        this.healthySince = now;
    }

    /** The presenter died, a spawn failed, READY timed out, or a ping failed. */
    noteDown(now: number, reason: string): void {
        this.clearFailuresAfterSustainedHealth(now);
        this.inFlight = false;
        this.healthySince = null;
        this.lastReason = reason;
        this.failureTimes.push(now);
        const index = Math.min(this.failureTimes.length - 1, this.backoffMs.length - 1);
        this.nextAllowedAt = now + this.backoffMs[index];
    }

    decide(now: number, ctx: { wanted: boolean }): SupervisorAction {
        if (this.inFlight) return { kind: 'none' };

        if (this.healthySince !== null) {
            this.clearFailuresAfterSustainedHealth(now);
            return { kind: 'none' };
        }

        // No match / overlay off: never spawn a presenter nobody needs.
        if (!ctx.wanted) return { kind: 'none' };

        // Once we have given up, stay on the Electron overlay until reset().
        if (this.fellBack) return { kind: 'none' };

        const failuresInWindow = this.failureTimes.filter(
            (at) => now - at <= this.failureWindowMs
        ).length;
        if (failuresInWindow >= this.maxFailuresInWindow) {
            this.fellBack = true;
            const last = this.lastReason ?? 'unknown';
            return {
                kind: 'fallback',
                reason: `presenter failed ${failuresInWindow} times within ${this.failureWindowMs}ms (last: ${last})`,
            };
        }

        if (now < this.nextAllowedAt) {
            return { kind: 'wait', untilMs: this.nextAllowedAt };
        }

        return { kind: 'respawn', attempt: this.respawns + 1 };
    }

    snapshot(): {
        inFlight: boolean;
        failures: number;
        respawns: number;
        fellBack: boolean;
        healthySince: number | null;
        lastReason: string | null;
    } {
        return {
            inFlight: this.inFlight,
            failures: this.failureTimes.length,
            respawns: this.respawns,
            fellBack: this.fellBack,
            healthySince: this.healthySince,
            lastReason: this.lastReason,
        };
    }

    /** New match or overlay toggle: forget failures, budget and fallback. */
    reset(): void {
        this.inFlight = false;
        this.healthySince = null;
        this.failureTimes = [];
        this.nextAllowedAt = 0;
        this.respawns = 0;
        this.fellBack = false;
        this.lastReason = null;
    }

    private clearFailuresAfterSustainedHealth(now: number): void {
        if (
            this.healthySince !== null &&
            now - this.healthySince >= this.healthyResetMs
        ) {
            this.failureTimes = [];
            this.nextAllowedAt = 0;
        }
    }
}
