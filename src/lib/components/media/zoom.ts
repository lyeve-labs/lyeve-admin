/**
 * Arithmetic for the image preview's zoom and pan. The image is drawn at
 * `scale` times its natural size, centered in the frame and then moved by
 * `pan`, in frame pixels.
 */

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 8;
/** One step of the plus and minus buttons and of a wheel notch. */
export const STEP = 1.25;

export interface Size {
	w: number;
	h: number;
}

export interface Point {
	x: number;
	y: number;
}

export function clampScale(s: number): number {
	return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

/**
 * The scale that shows the whole image in the frame. A small image stays at
 * its own size: scaling a 96 pixel icon up to the frame is a blur.
 */
export function fitScale(image: Size, frame: Size): number {
	if (image.w <= 0 || image.h <= 0 || frame.w <= 0 || frame.h <= 0) return 1;
	return clampScale(Math.min(frame.w / image.w, frame.h / image.h, 1));
}

/**
 * Keeps the image from being dragged out of the frame. On an axis where the
 * image is smaller than the frame it stays centered. Where it is larger its
 * edges may not come inside the frame's.
 */
export function clampPan(pan: Point, scale: number, image: Size, frame: Size): Point {
	const limit = (img: number, box: number, v: number) => {
		const room = Math.max(0, (img * scale - box) / 2);
		return Math.min(room, Math.max(-room, v));
	};
	return { x: limit(image.w, frame.w, pan.x), y: limit(image.h, frame.h, pan.y) };
}

/**
 * Changes the scale so that the image point under `at` (frame coordinates,
 * origin top left) stays under it, the way every image viewer zooms toward
 * the cursor.
 */
export function zoomAt(scale: number, next: number, at: Point, pan: Point, image: Size, frame: Size): { scale: number; pan: Point } {
	const to = clampScale(next);
	const cx = at.x - frame.w / 2 - pan.x;
	const cy = at.y - frame.h / 2 - pan.y;
	const k = to / scale;
	const moved = { x: pan.x + cx - cx * k, y: pan.y + cy - cy * k };
	return { scale: to, pan: clampPan(moved, to, image, frame) };
}

/** The scale one step up or down from `scale`. */
export function stepScale(scale: number, direction: 1 | -1): number {
	return clampScale(direction > 0 ? scale * STEP : scale / STEP);
}
