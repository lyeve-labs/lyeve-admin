import { describe, expect, it } from 'vitest';
import { ApiError } from '@lyeve-labs/client';
import { triggerWriteRefusal } from './email-triggers';

const answering = (err: unknown) =>
	({
		get: async () => {
			if (err) throw err;
			return { data: [] };
		},
	}) as never;

describe('whether the license allows trigger writes', () => {
	it('reads a 402 naming a capability as a refusal', async () => {
		const refused = await triggerWriteRefusal(answering(new ApiError(402, 'payment required', { feature: 'email-pro', plugin: 'email' })));
		expect(refused?.kind).toBe('feature');
	});

	it('reads an answer, or any other failure, as no refusal', async () => {
		expect(await triggerWriteRefusal(answering(null))).toBeNull();
		expect(await triggerWriteRefusal(answering(new ApiError(503, 'down')))).toBeNull();
	});
});
