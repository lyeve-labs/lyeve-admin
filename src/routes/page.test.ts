import { describe, expect, it } from 'vitest';
import { load } from './+page';

describe('root page', () => {
	it('sends the bare host to the dashboard before anything renders', () => {
		let thrown: unknown;
		try {
			load({} as never);
		} catch (err) {
			thrown = err;
		}
		expect(thrown).toMatchObject({ status: 307, location: '/admin' });
	});
});
