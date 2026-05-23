import { describe, expect, it } from 'vitest';
import { MAX_SCALE, MIN_SCALE, clampPan, clampScale, fitScale, stepScale, zoomAt } from './zoom';

const image = { w: 2000, h: 1000 };
const frame = { w: 800, h: 600 };

describe('image zoom', () => {
	it('fits a large image and leaves a small one at its own size', () => {
		expect(fitScale(image, frame)).toBeCloseTo(0.4);
		expect(fitScale({ w: 96, h: 96 }, frame)).toBe(1);
	});

	it('clamps the scale', () => {
		expect(clampScale(100)).toBe(MAX_SCALE);
		expect(clampScale(0)).toBe(MIN_SCALE);
		expect(stepScale(1, 1)).toBeCloseTo(1.25);
		expect(stepScale(1, -1)).toBeCloseTo(0.8);
	});

	it('keeps the point under the cursor where it was', () => {
		const at = { x: 700, y: 100 };
		const before = { scale: 1, pan: { x: 0, y: 0 } };
		const after = zoomAt(before.scale, 2, at, before.pan, image, frame);
		// The image point under the cursor, in image pixels, before and after.
		const point = (s: number, p: { x: number; y: number }) => ({
			x: (at.x - frame.w / 2 - p.x) / s,
			y: (at.y - frame.h / 2 - p.y) / s,
		});
		expect(point(after.scale, after.pan).x).toBeCloseTo(point(before.scale, before.pan).x);
		expect(point(after.scale, after.pan).y).toBeCloseTo(point(before.scale, before.pan).y);
	});

	it('does not let the image leave the frame', () => {
		expect(clampPan({ x: 5000, y: -5000 }, 1, image, frame)).toEqual({ x: 600, y: -200 });
		// Smaller than the frame on both axes: centered.
		expect(clampPan({ x: 50, y: 50 }, 0.2, image, frame)).toEqual({ x: 0, y: 0 });
	});
});
