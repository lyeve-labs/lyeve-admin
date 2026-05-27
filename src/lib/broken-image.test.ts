// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { brokenImage } from './broken-image';

function tile(): { wrapper: HTMLElement; img: HTMLImageElement } {
	const wrapper = document.createElement('div');
	const img = document.createElement('img');
	img.setAttribute('src', '/api/admin/media/abc/download');
	wrapper.appendChild(img);
	document.body.appendChild(wrapper);
	return { wrapper, img };
}

describe('brokenImage', () => {
	it('flags an image that fails after the action attaches', () => {
		const { wrapper, img } = tile();
		const onBroken = vi.fn();

		brokenImage(wrapper, onBroken);
		// error does not bubble, so a wrapper only sees it in the capture phase.
		img.dispatchEvent(new Event('error'));

		expect(onBroken).toHaveBeenCalledTimes(1);
	});

	it('flags an image that already failed before hydration reached it', () => {
		const { wrapper, img } = tile();
		Object.defineProperty(img, 'complete', { value: true });
		Object.defineProperty(img, 'naturalWidth', { value: 0 });
		const onBroken = vi.fn();

		brokenImage(wrapper, onBroken);

		expect(onBroken).toHaveBeenCalledTimes(1);
	});

	it('leaves a tile with no image source alone', () => {
		const { wrapper, img } = tile();
		img.removeAttribute('src');
		Object.defineProperty(img, 'complete', { value: true });
		Object.defineProperty(img, 'naturalWidth', { value: 0 });
		const onBroken = vi.fn();

		brokenImage(wrapper, onBroken);

		expect(onBroken).not.toHaveBeenCalled();
	});

	it('leaves an image that decoded alone', () => {
		const { wrapper, img } = tile();
		Object.defineProperty(img, 'complete', { value: true });
		Object.defineProperty(img, 'naturalWidth', { value: 64 });
		const onBroken = vi.fn();

		brokenImage(wrapper, onBroken);

		expect(onBroken).not.toHaveBeenCalled();
	});

	it('ignores a failure from something that is not an image', () => {
		const { wrapper } = tile();
		const script = document.createElement('script');
		wrapper.appendChild(script);
		const onBroken = vi.fn();

		brokenImage(wrapper, onBroken);
		script.dispatchEvent(new Event('error'));

		expect(onBroken).not.toHaveBeenCalled();
	});

	it('calls the latest callback after an update', () => {
		const { wrapper, img } = tile();
		const first = vi.fn();
		const second = vi.fn();

		const handle = brokenImage(wrapper, first);
		handle?.update?.(second);
		img.dispatchEvent(new Event('error'));

		expect(first).not.toHaveBeenCalled();
		expect(second).toHaveBeenCalledTimes(1);
	});

	it('stops listening once destroyed', () => {
		const { wrapper, img } = tile();
		const onBroken = vi.fn();

		const handle = brokenImage(wrapper, onBroken);
		handle?.destroy?.();
		img.dispatchEvent(new Event('error'));

		expect(onBroken).not.toHaveBeenCalled();
	});
});
