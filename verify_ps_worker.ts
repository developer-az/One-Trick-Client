// Persistent PowerShell OCR host: same output as a cold run, exit codes survive,
// a timeout recovers, and warm calls are fast. Windows only (skips elsewhere).
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PsScriptWorker, psInvocation } from './electron/ps-worker';

let failed = 0;
const check = (name: string, ok: boolean): void => {
    console.log(`${ok ? 'ok' : 'FAIL'} ${name}`);
    if (!ok) failed++;
};

check(
    'quotes values and passes switches bare',
    psInvocation("C:\\a'b.ps1", { CaptureScreen: true, Off: false, ImagePath: "x'y", OwnerPid: 7 }).includes(
        "& 'C:\\a''b.ps1' -CaptureScreen -ImagePath 'x''y' -OwnerPid '7'"
    )
);

async function main(): Promise<void> {
    if (process.platform !== 'win32') {
        console.log('verify_ps_worker: skipped (not Windows)');
        return;
    }
    const script = path.resolve('electron/scripts/mayhem-ocr.ps1');
    const img = path.resolve('test-fixtures/mayhem-ocr/labelled/positive-3-en.png');
    const w = new PsScriptWorker();
    try {
        const first = await w.run(script, { ImagePath: img }, 30_000);
        check('fixture OCR exits 0', first.code === 0);
        check('fixture OCR reads the three cards', ['Recursion', 'Eureka', 'Goliath'].every((t) => first.out.includes(t)));
        check('end marker is stripped', !first.out.includes('__OT_END__'));

        const missing = await w.run(script, { ImagePath: path.join(os.tmpdir(), 'ot-missing.png') }, 30_000);
        check('a throwing script fails with its error text', missing.code === 1 && /ImagePath missing/.test(missing.err));

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ot ps'w-"));
        const exit7 = path.join(tmpDir, 'exit7.ps1');
        fs.writeFileSync(exit7, 'Write-Output hi\nexit 7\n');
        const seven = await w.run(exit7, {}, 30_000);
        check('script exit code is reported (exit 7)', seven.code === 7 && seven.out.includes('hi'));

        const t0 = Date.now();
        const again = await w.run(script, { ImagePath: img }, 30_000);
        const warmMs = Date.now() - t0;
        check('host survives a non-zero exit', again.code === 0 && again.out.includes('Goliath'));
        check(`warm call is fast (${warmMs} ms < 250)`, warmMs < 250);

        const slow = path.join(tmpDir, 'slow.ps1');
        fs.writeFileSync(slow, 'Start-Sleep -Seconds 5\n');
        const timedOut = await w.run(slow, {}, 300).then(() => false, (e) => /timed out/.test(String(e)));
        check('a hung script times out', timedOut);
        const recovered = await w.run(script, { ImagePath: img }, 30_000);
        check('next call after a timeout runs on a fresh host', recovered.code === 0 && recovered.out.includes('Recursion'));
        fs.rmSync(tmpDir, { recursive: true, force: true });
    } finally {
        w.dispose();
    }
}

main().then(() => {
    if (failed) {
        console.log(`${failed} failed`);
        process.exit(1);
    }
    console.log('verify_ps_worker: all ok');
});
