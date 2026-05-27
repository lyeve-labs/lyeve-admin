import { describe, expect, it } from 'vitest';
import { copyName, duplicateRow } from './duplicate';

/*
 * Duplicate is client-side, so the helper is where the four rules live. Each
 * is here because the naive version is a defect somebody would otherwise ship
 * once per list.
 */
describe('copyName', () => {
	it('suffixes rather than prefixes, so a second copy has somewhere to go', () => {
		expect(copyName('Burst limit', [])).toBe('Burst limit (copy)');
	});

	it('counts past a name already taken', () => {
		expect(copyName('Burst limit', ['Burst limit (copy)'])).toBe('Burst limit (copy 2)');
		expect(copyName('Burst limit', ['Burst limit (copy)', 'Burst limit (copy 2)'])).toBe(
			'Burst limit (copy 3)',
		);
	});

	it('survives a gap in the taken names', () => {
		expect(copyName('X', ['X (copy)', 'X (copy 3)'])).toBe('X (copy 2)');
	});
});

describe('duplicateRow', () => {
	const rule = {
		id: 'r1',
		name: 'Burst limit',
		requests: 100,
		window: '1m',
		enabled: true,
		created_at: '2026-09-01T00:00:00Z',
		updated_at: '2026-09-02T00:00:00Z',
	};

	it('keeps the shape and drops the identity', () => {
		const draft = duplicateRow(rule);
		expect(draft.requests).toBe(100);
		expect(draft.window).toBe('1m');
		expect(draft).not.toHaveProperty('id');
		expect(draft).not.toHaveProperty('created_at');
		expect(draft).not.toHaveProperty('updated_at');
	});

	// A duplicated rate limit that starts enforcing the moment it saves is a
	// surprise nobody asked for, and so is a webhook that starts delivering.
	it('never arrives enabled, whichever word the resource uses', () => {
		expect(duplicateRow(rule).enabled).toBe(false);
		expect(duplicateRow({ name: 'W', active: true }).active).toBe(false);
		expect(duplicateRow({ name: 'W', is_enabled: true }).is_enabled).toBe(false);
	});

	it('leaves a resource that has no enabled field alone', () => {
		expect(duplicateRow({ name: 'W', requests: 1 })).not.toHaveProperty('enabled');
	});

	// A key, a token or a signing secret is the receiver's trust anchor. Two
	// rows sharing one means revoking either revokes both.
	it('copies no secret of any spelling', () => {
		const draft = duplicateRow({
			name: 'Stripe',
			url: 'https://example.com/hook',
			secret: 'whsec_live',
			signing_secret: 'whsec_live',
			api_key: 'sk_live',
			access_key: 'AKIA',
			secret_key: 'abc',
			token: 't',
			password: 'p',
		});
		expect(draft.url).toBe('https://example.com/hook');
		for (const field of [
			'secret',
			'signing_secret',
			'api_key',
			'access_key',
			'secret_key',
			'token',
			'password',
		]) {
			expect(draft, field).not.toHaveProperty(field);
		}
	});

	it('takes a resource-specific omission', () => {
		const draft = duplicateRow({ name: 'P', bucket: 'b', region: 'r' }, { omit: ['region'] });
		expect(draft.bucket).toBe('b');
		expect(draft).not.toHaveProperty('region');
	});

	it('names the copy clear of the names already in the list', () => {
		const draft = duplicateRow(rule, { taken: ['Burst limit (copy)'] });
		expect(draft.name).toBe('Burst limit (copy 2)');
	});

	it('takes a different name field where the resource uses one', () => {
		const draft = duplicateRow({ title: 'Weekly', id: 'x' }, { nameField: 'title' });
		expect(draft.title).toBe('Weekly (copy)');
	});

	it('leaves a nameless row nameless rather than inventing one', () => {
		expect(duplicateRow({ id: 'x', requests: 5 })).not.toHaveProperty('name');
	});
});
