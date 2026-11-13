/**
 * Presenter frame cropping: the dirty rect is already physical pixels.
 *
 * Electron 39 offscreen 'paint' hands us the full BGRA frame plus a dirty rect
 * measured in physical pixels of that same frame (e.g. 1001x750 for an 800x600
 * window at 1.25 scale). The presenter pastes the payload at the header's
 * (x, y), so shipping the full bitmap under a scaled rect shifts the HUD.
 * These checks pin the pure crop used by forwardPaint().
 */
import fs from 'node:fs';
import { cropDirtyRect, type CroppedFrame } from './electron/presenter-frame';

function ok(cond: boolean, msg: string): void {
    if (!cond) {
        console.error('FAIL', msg);
        process.exitCode = 1;
    } else {
        console.log('ok', msg);
    }
}

function read(rel: string): string {
    return fs.readFileSync(rel, 'utf8');
}

/** Top-down BGRA bitmap where each pixel encodes its own (x, y) coordinates. */
function makeBitmap(width: number, height: number): Buffer {
    const buf = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            buf[i] = x & 0xff;
            buf[i + 1] = y & 0xff;
            buf[i + 2] = 0;
            buf[i + 3] = 255;
        }
    }
    return buf;
}

/** Compare every pixel of a crop against the source bitmap's coordinate encoding. */
function cropMatches(bitmap: Buffer, imageWidth: number, cropped: CroppedFrame): boolean {
    if (cropped.data.length !== cropped.width * cropped.height * 4) return false;
    for (let row = 0; row < cropped.height; row++) {
        for (let col = 0; col < cropped.width; col++) {
            const src = ((cropped.y + row) * imageWidth + (cropped.x + col)) * 4;
            const dst = (row * cropped.width + col) * 4;
            for (let channel = 0; channel < 4; channel++) {
                if (cropped.data[dst + channel] !== bitmap[src + channel]) return false;
            }
        }
    }
    return true;
}

// ---- whole-image dirty rect: no copy ----
const fullBitmap = makeBitmap(100, 80);
const full = cropDirtyRect(fullBitmap, 100, 80, { x: 0, y: 0, width: 100, height: 80 });
ok(!!full, 'whole-image dirty rect returns a frame');
ok(full?.x === 0 && full?.y === 0 && full?.width === 100 && full?.height === 80, 'whole-image rect keeps its geometry');
ok(full?.data === fullBitmap, 'whole-image dirty rect returns the same Buffer instance (no copy)');

// A fractional rect that still clamps to the whole image also avoids the copy.
const fullFractional = cropDirtyRect(fullBitmap, 100, 80, { x: -0.5, y: -0.5, width: 100.9, height: 80.9 });
ok(fullFractional?.data === fullBitmap, 'fractional whole-image rect also returns the original Buffer');

// ---- interior 64x63 rect: copy the correct bytes, row by row ----
const interiorBitmap = makeBitmap(1001, 750);
const interior = cropDirtyRect(interiorBitmap, 1001, 750, {
    x: 750,
    y: 500,
    width: 64,
    height: 63,
});
ok(!!interior, 'physical 64x63 interior rect returns a frame');
ok(
    interior?.x === 750 && interior?.y === 500 && interior?.width === 64 && interior?.height === 63,
    'interior rect geometry is unchanged (no scaleFactor multiplication)'
);
ok(interior?.data.length === 64 * 63 * 4, 'interior crop is exactly w*h*4 bytes');
ok(!!interior && interior.data !== interiorBitmap, 'interior crop is a new Buffer, not the whole frame');
ok(!!interior && cropMatches(interiorBitmap, 1001, interior), 'interior crop contains every row of the dirty rect');

// ---- partly outside the image: clamped ----
const edgeBitmap = makeBitmap(10, 10);
const topLeft = cropDirtyRect(edgeBitmap, 10, 10, { x: -4, y: -3, width: 8, height: 6 });
ok(
    topLeft?.x === 0 && topLeft?.y === 0 && topLeft?.width === 4 && topLeft?.height === 3,
    'rect overflowing the top-left is clamped to the image'
);
ok(!!topLeft && cropMatches(edgeBitmap, 10, topLeft), 'clamped top-left crop reads the right pixels');
const bottomRight = cropDirtyRect(edgeBitmap, 10, 10, { x: 8, y: 8, width: 10, height: 10 });
ok(
    bottomRight?.x === 8 && bottomRight?.y === 8 && bottomRight?.width === 2 && bottomRight?.height === 2,
    'rect overflowing the bottom-right is clamped to the image'
);
ok(!!bottomRight && cropMatches(edgeBitmap, 10, bottomRight), 'clamped bottom-right crop reads the right pixels');

// ---- fractional rect: floor origin, ceil far edges ----
const fracBitmap = makeBitmap(20, 20);
const frac = cropDirtyRect(fracBitmap, 20, 20, { x: 10.4, y: 10.6, width: 5.2, height: 5.2 });
ok(
    frac?.x === 10 && frac?.y === 10 && frac?.width === 6 && frac?.height === 6,
    'fractional rect floors x/y and ceils right/bottom (10.4..15.6 -> 10..16)'
);
ok(!!frac && cropMatches(fracBitmap, 20, frac), 'fractional crop reads the rounded-out pixels');

// ---- zero-size and negative-size rects: null ----
ok(cropDirtyRect(edgeBitmap, 10, 10, { x: 3, y: 3, width: 0, height: 4 }) === null, 'zero-width rect returns null');
ok(cropDirtyRect(edgeBitmap, 10, 10, { x: 3, y: 3, width: 4, height: 0 }) === null, 'zero-height rect returns null');
ok(cropDirtyRect(edgeBitmap, 10, 10, { x: 0, y: 0, width: 0, height: 0 }) === null, 'zero-size rect returns null');
ok(cropDirtyRect(edgeBitmap, 10, 10, { x: 5, y: 5, width: -3, height: 4 }) === null, 'negative-width rect returns null');
ok(cropDirtyRect(edgeBitmap, 10, 10, { x: 5, y: 5, width: 4, height: -3 }) === null, 'negative-height rect returns null');
ok(cropDirtyRect(edgeBitmap, 10, 10, { x: 20, y: 0, width: 4, height: 4 }) === null, 'rect fully outside the image returns null');

// ---- non-finite inputs: null ----
ok(cropDirtyRect(edgeBitmap, 10, 10, { x: NaN, y: 0, width: 4, height: 4 }) === null, 'NaN x returns null');
ok(cropDirtyRect(edgeBitmap, 10, 10, { x: 0, y: 0, width: Infinity, height: 4 }) === null, 'Infinity width returns null');
ok(cropDirtyRect(edgeBitmap, 10, 10, { x: 0, y: 0, width: 4, height: -Infinity }) === null, '-Infinity height returns null');
ok(cropDirtyRect(edgeBitmap, NaN, 10, { x: 0, y: 0, width: 4, height: 4 }) === null, 'NaN imageWidth returns null');
ok(cropDirtyRect(edgeBitmap, 10, Infinity, { x: 0, y: 0, width: 4, height: 4 }) === null, 'Infinity imageHeight returns null');

// ---- bitmap length must match the stated dimensions ----
ok(cropDirtyRect(Buffer.alloc(10 * 10 * 4 - 4), 10, 10, { x: 0, y: 0, width: 4, height: 4 }) === null, 'short bitmap returns null');
ok(cropDirtyRect(Buffer.alloc(10 * 10 * 4 + 4), 10, 10, { x: 0, y: 0, width: 4, height: 4 }) === null, 'long bitmap returns null');

// ---- 1x1 image ----
const one = makeBitmap(1, 1);
const oneFull = cropDirtyRect(one, 1, 1, { x: 0, y: 0, width: 1, height: 1 });
ok(oneFull?.width === 1 && oneFull?.height === 1, '1x1 image crops its single pixel');
ok(oneFull?.data === one, '1x1 whole-image crop returns the original Buffer');
const oneEmpty = cropDirtyRect(one, 1, 1, { x: 0, y: 0, width: 0.2, height: 0 });
ok(oneEmpty === null, '1x1 empty rect returns null');

// ---- the driver actually uses the crop and drops the scaling ----
const driver = read('electron/overlay-presenter.ts');
ok(driver.includes('cropDirtyRect'), 'overlay-presenter.ts imports/uses cropDirtyRect');
ok(!driver.includes('physicalRect(dirtyRect)'), 'overlay-presenter.ts no longer scale-multiplies the dirty rect');
ok(driver.includes("webContents.on('paint'"), 'overlay-presenter.ts still forwards paint events');
ok(driver.includes('this.framesDropped++'), 'overlay-presenter.ts still counts dropped frames');
