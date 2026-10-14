import { beforeEach, describe, expect, it, vi } from 'vitest';

const navigation = vi.hoisted(() => ({ invalidate: vi.fn(async () => {}), invalidateAll: vi.fn(async () => {}) }));
vi.mock('$app/navigation', () => navigation);

import { refresher } from './refresher';

beforeEach(() => vi.clearAllMocks());

describe('refresher', () => {
	it('reruns the loads that depend on its key and leaves the rest alone', async () => {
		await refresher('app:events', () => {})();
		expect(navigation.invalidate).toHaveBeenCalledWith('app:events');
		expect(navigation.invalidateAll).not.toHaveBeenCalled();
	});

	it('reports busy while the reread runs, and clears it when the reread fails', async () => {
		const seen: boolean[] = [];
		navigation.invalidate.mockRejectedValueOnce(new Error('offline'));
		await expect(refresher('app:events', (on) => seen.push(on))()).rejects.toThrow('offline');
		expect(seen).toEqual([true, false]);
	});
});
