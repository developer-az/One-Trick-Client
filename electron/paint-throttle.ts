// Strict main-process paint throttle for the native overlay driver.
//
// Electron's offscreen renderer fires 'paint' whenever the HUD page redraws,
// which can burst far past the 12 fps presentation budget (state updates plus
// the HUD's own clocks). This helper caps forwarded paints to one per
// `intervalMs` window: the leading paint of a window is shipped immediately so
// a fresh frame never waits out a full window, every intermediate paint is
// dropped and only its dirty rect is merged into a running union, and the
// union — the latest dirty region — is flushed once the window elapses.
//
// Pure and clock-injected (no electron import), so it is unit-testable under
// plain tsx and deterministic in the verify harness.

export interface PaintRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface PaintThrottle {
    /**
     * Feed one paint's dirty rect. Returns the rect to ship immediately when
     * it is the leading paint of a fresh window; returns null when the paint
     * was held (dropped) and its rect merged into the pending union.
     */
    accept(rect: PaintRect): PaintRect | null;
    /**
     * Consume the held union once the current window has elapsed. Always
     * flushes the latest held paint; returns null when the window is still
     * open or nothing was held.
     */
    flush(): PaintRect | null;
    /** Absolute time (in nowFn() units) when the held paint becomes due, or null. */
    flushAt(): number | null;
    /** True while a throttle window is open. */
    windowOpen(): boolean;
    /** Drop all pending state (surface teardown / respawn). */
    reset(): void;
}

function unionRect(a: PaintRect, b: PaintRect): PaintRect {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    return {
        x,
        y,
        width: Math.max(a.x + a.width, b.x + b.width) - x,
        height: Math.max(a.y + a.height, b.y + b.height) - y,
    };
}

export function createPaintThrottle(
    nowFn: () => number,
    intervalMs: number
): PaintThrottle {
    /** Absolute time the current window closes; 0 = idle (no window open). */
    let windowEndAt = 0;
    /** Union of the dirty rects of every paint dropped in the current window. */
    let held: PaintRect | null = null;

    return {
        accept(rect: PaintRect): PaintRect | null {
            const now = nowFn();
            if (windowEndAt !== 0) {
                // Mid-window: drop the paint, merge its rect into the union.
                held = held ? unionRect(held, rect) : { ...rect };
                return null;
            }
            // Leading paint of a fresh window: ship it, open the window.
            windowEndAt = now + intervalMs;
            held = null;
            return { ...rect };
        },
        flush(): PaintRect | null {
            if (windowEndAt === 0 || nowFn() < windowEndAt) return null;
            const rect = held;
            windowEndAt = 0;
            held = null;
            return rect;
        },
        flushAt(): number | null {
            return windowEndAt === 0 ? null : windowEndAt;
        },
        windowOpen(): boolean {
            return windowEndAt !== 0;
        },
        reset(): void {
            windowEndAt = 0;
            held = null;
        },
    };
}
