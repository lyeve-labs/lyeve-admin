// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { overlayClosed } from './overlay';

afterEach(() => {
	document.body.innerHTML = '';
});

describe('overlayClosed', () => {
	it('resolves at once when nothing is leaving', async () => {
		document.body.innerHTML = '<div role="dialog" aria-modal="true"></div>';
		await expect(overlayClosed()).resolves.toBeUndefined();
	});

	it('waits for a leaving overlay to leave the page', async () => {
		document.body.innerHTML = '<div role="dialog" aria-modal="true" inert></div>';
		let done = false;
		const closed = overlayClosed().then(() => (done = true));

		await new Promise((r) => setTimeout(r, 10));
		expect(done).toBe(false);

		document.querySelector('[role="dialog"]')!.remove();
		await closed;
		expect(done).toBe(true);
	});
});
