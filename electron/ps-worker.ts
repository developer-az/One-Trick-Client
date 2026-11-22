import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';

/**
 * One long-lived `powershell -Command -` that runs a .ps1 per request.
 *
 * A cold `powershell -File` costs ~550 ms per OCR call (process start, Add-Type
 * compile, WinRT type load); a warm host answers the same script in ~40 ms.
 * Requests are serialized; a timeout or crash kills the host and the next
 * request starts a fresh one.
 */
export type PsParams = Record<string, string | number | boolean>;

export interface PsResult {
    out: string;
    err: string;
    code: number;
}

const END = '__OT_END__';

const quote = (v: string): string => `'${v.replace(/'/g, "''")}'`;

/** One-line PowerShell command: run the script, then print the end marker with its exit code. */
export function psInvocation(script: string, params: PsParams): string {
    const args = Object.entries(params)
        .filter(([, v]) => v !== false)
        .map(([k, v]) => (v === true ? `-${k}` : `-${k} ${quote(String(v))}`))
        .join(' ');
    return (
        `$global:LASTEXITCODE=0; try { & ${quote(script)} ${args} } ` +
        `catch { [Console]::Error.WriteLine($_); $global:LASTEXITCODE=1 }; ` +
        `Write-Output ('${END} ' + $LASTEXITCODE)`
    );
}

export class PsScriptWorker {
    private child: ChildProcessWithoutNullStreams | null = null;
    private queue: Promise<unknown> = Promise.resolve();

    run(script: string, params: PsParams, timeoutMs: number): Promise<PsResult> {
        const job = this.queue.then(() => this.runNow(script, params, timeoutMs));
        this.queue = job.catch(() => undefined);
        return job;
    }

    dispose(): void {
        const child = this.child;
        this.child = null;
        if (!child) return;
        try {
            child.stdin.end();
            child.kill();
        } catch {
            /* already gone */
        }
    }

    private host(): ChildProcessWithoutNullStreams {
        if (this.child && this.child.exitCode === null) return this.child;
        const child = spawn(
            'powershell.exe',
            ['-NoProfile', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-Command', '-'],
            { windowsHide: true }
        );
        child.on('exit', () => {
            if (this.child === child) this.child = null;
        });
        child.on('error', () => {
            if (this.child === child) this.child = null;
        });
        this.child = child;
        return child;
    }

    private runNow(script: string, params: PsParams, timeoutMs: number): Promise<PsResult> {
        return new Promise((resolve, reject) => {
            const child = this.host();
            let out = '';
            let err = '';
            let done = false;
            const cleanup = (): void => {
                done = true;
                clearTimeout(timer);
                child.stdout.off('data', onOut);
                child.stderr.off('data', onErr);
                child.off('exit', onExit);
            };
            const onOut = (chunk: Buffer): void => {
                out += String(chunk);
                const at = out.indexOf(END);
                if (at < 0) return;
                const tail = out.slice(at + END.length);
                const nl = tail.indexOf('\n');
                if (nl < 0) return; // exit code not fully arrived yet
                cleanup();
                resolve({ out: out.slice(0, at), err, code: Number.parseInt(tail.slice(0, nl).trim(), 10) || 0 });
            };
            const onErr = (chunk: Buffer): void => {
                err += String(chunk);
            };
            const onExit = (): void => {
                if (done) return;
                cleanup();
                reject(new Error(err.trim() || 'PowerShell worker exited'));
            };
            const timer = setTimeout(() => {
                if (done) return;
                cleanup();
                this.dispose();
                reject(new Error(`PowerShell worker timed out after ${timeoutMs} ms`));
            }, timeoutMs);
            child.stdout.on('data', onOut);
            child.stderr.on('data', onErr);
            child.on('exit', onExit);
            child.stdin.write(psInvocation(script, params) + '\n');
        });
    }
}
