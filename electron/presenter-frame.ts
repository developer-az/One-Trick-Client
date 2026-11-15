// Pure frame cropping for the native presenter wire format.
//
// Electron hands the offscreen driver a full-frame BGRA bitmap plus a dirty
// rectangle that is already expressed in physical pixels of that bitmap. The
// presenter pastes whatever it receives at the header's (x, y), so the driver
// must ship exactly the dirty sub-rectangle instead of the whole frame.
//
// No electron import: this module stays unit-testable under plain tsx.

export interface DirtyRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface CroppedFrame {
    x: number;
    y: number;
    width: number;
    height: number;
    data: Buffer;
}

/**
 * Crop `dirty` out of a top-down BGRA `bitmap` of `imageWidth` x `imageHeight`.
 *
 * Edges are snapped outward (floor the origin, ceil the far edges) and then
 * clamped to the image. Returns null for a corrupt bitmap, non-finite input,
 * or an empty result. When the dirty rect covers the whole image the original
 * Buffer is returned untouched; otherwise rows are copied into a new Buffer.
 */
export function cropDirtyRect(
    bitmap: Buffer,
    imageWidth: number,
    imageHeight: number,
    dirty: DirtyRect
): CroppedFrame | null {
    if (
        !Number.isFinite(imageWidth) ||
        !Number.isFinite(imageHeight) ||
        !Number.isFinite(dirty.x) ||
        !Number.isFinite(dirty.y) ||
        !Number.isFinite(dirty.width) ||
        !Number.isFinite(dirty.height)
    ) {
        return null;
    }
    if (bitmap.length !== imageWidth * imageHeight * 4) return null;
    const left = Math.max(0, Math.min(imageWidth, Math.floor(dirty.x)));
    const top = Math.max(0, Math.min(imageHeight, Math.floor(dirty.y)));
    const right = Math.max(0, Math.min(imageWidth, Math.ceil(dirty.x + dirty.width)));
    const bottom = Math.max(0, Math.min(imageHeight, Math.ceil(dirty.y + dirty.height)));
    const width = right - left;
    const height = bottom - top;
    if (width <= 0 || height <= 0) return null;
    if (width === imageWidth && height === imageHeight) {
        // Clamped to the full image: no copy, ship the caller's Buffer.
        return { x: left, y: top, width, height, data: bitmap };
    }
    const stride = imageWidth * 4;
    const rowBytes = width * 4;
    const data = Buffer.alloc(rowBytes * height);
    for (let row = 0; row < height; row++) {
        const src = (top + row) * stride + left * 4;
        bitmap.copy(data, row * rowBytes, src, src + rowBytes);
    }
    return { x: left, y: top, width, height, data };
}
