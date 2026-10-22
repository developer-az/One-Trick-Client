/**
 * HUD ROI geometry matrix check + optional seed file for vision work.
 * Run: npx --yes tsx verify_hud_geometry.ts
 */
import fs from 'fs';
import path from 'path';
import { buildHudGeometry, verifyHudGeometry } from './src/vision/hud-geometry';

const matrixOk = verifyHudGeometry();
const seedPath = path.join('out', 'rois-seed.json');
fs.mkdirSync('out', { recursive: true });
fs.writeFileSync(
    seedPath,
    JSON.stringify(
        {
            version: 1,
            input: { width: 1920, height: 1080, hudScale: 100, mapScale: 100, minimapSide: 'right' },
            rois: buildHudGeometry({ width: 1920, height: 1080, hudScale: 100, mapScale: 100, minimapSide: 'right' }),
        },
        null,
        2
    )
);
console.log(`Wrote seed ${seedPath}`);
if (!matrixOk) process.exitCode = 1;
