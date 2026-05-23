import { describe, expect, it, vi } from 'vitest';
import { ApiError, type HttpClient } from '@lyeve-labs/client';
import { LICENSE_URL, licensingOf, linkOf, NO_LICENSING, readLicensing, REL } from './license';

function client(get: () => Promise<unknown>): HttpClient & { get: ReturnType<typeof vi.fn> } {
	return { get: vi.fn(get) } as unknown as HttpClient & { get: ReturnType<typeof vi.fn> };
}

const served = {
	links: [
		{ rel: 'upgrade', label: 'Turn it on', url: '/admin/settings/license' },
		{ rel: 'portal', label: 'Your account', url: 'https://example.test/account' },
		{ rel: 'support', label: 'Help', url: 'https://example.test/help' },
	],
	renew: true,
};

describe('readLicensing', () => {
	it('reads the links and the renewal from the route every role may read', async () => {
		const c = client(async () => served);
		expect(await readLicensing(c)).toEqual({
			links: [
				{ rel: 'upgrade', label: 'Turn it on', href: '/admin/settings/license' },
				{ rel: 'portal', label: 'Your account', href: 'https://example.test/account' },
				{ rel: 'support', label: 'Help', href: 'https://example.test/help' },
			],
			renew: true,
		});
		expect(c.get).toHaveBeenCalledWith(LICENSE_URL);
	});

	it('comes to nothing on a build without a module, and on a failed read', async () => {
		expect(await readLicensing(client(async () => Promise.reject(new ApiError(404, 'not found'))))).toEqual(NO_LICENSING);
		expect(await readLicensing(client(async () => Promise.reject(new ApiError(503, 'unavailable'))))).toEqual(NO_LICENSING);
		expect(await readLicensing(client(async () => Promise.reject(new Error('network'))))).toEqual(NO_LICENSING);
	});
});

describe('licensingOf', () => {
	it('keeps only a link it can place, name and follow', () => {
		const got = licensingOf({
			links: [
				{ rel: 'purchase', label: 'Get a license', url: 'javascript:alert(1)' },
				{ rel: 'purchase', label: 'Get a license', url: 'http://example.test/license' },
				{ rel: 'docs', label: 'Docs', url: '//example.test/docs' },
				{ rel: 'support', label: 'Help', url: '/elsewhere' },
				{ rel: 'elsewhere', label: 'Other', url: 'https://example.test/other' },
				{ rel: 'portal', label: '  ', url: 'https://example.test/account' },
				{ rel: 'docs', label: ' Docs ', url: 'https://example.test/docs' },
				{ rel: 'docs', label: 'Second', url: 'https://example.test/second' },
				'not a link',
				null,
			],
			renew: false,
		});
		expect(got).toEqual({ links: [{ rel: 'docs', label: 'Docs', href: 'https://example.test/docs' }], renew: false });
	});

	it('reads a missing or malformed answer as no links and no renewal', () => {
		expect(licensingOf(null)).toEqual(NO_LICENSING);
		expect(licensingOf({})).toEqual(NO_LICENSING);
		expect(licensingOf('text')).toEqual(NO_LICENSING);
		expect(licensingOf({ links: 'none', renew: 'yes' })).toEqual(NO_LICENSING);
	});
});

describe('linkOf', () => {
	it('finds the link for a relation, and nothing for one the module does not serve', () => {
		const licensing = licensingOf(served);
		expect(linkOf(licensing, REL.support)).toEqual({ rel: 'support', label: 'Help', href: 'https://example.test/help' });
		expect(linkOf(licensing, REL.purchase)).toBeNull();
		expect(linkOf(null, REL.support)).toBeNull();
	});
});
