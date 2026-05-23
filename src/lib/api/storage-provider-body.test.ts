import { describe, expect, it } from 'vitest';
import { PROVIDER_FIELDS, isCredential, providerBodyFrom } from './storage';

const form = (entries: Record<string, string>) => {
	const f = new FormData();
	for (const [k, v] of Object.entries(entries)) f.set(k, v);
	return f;
};

describe('providerBodyFrom', () => {
	it('builds an S3 body from the fields its type asks for', () => {
		const r = providerBodyFrom(
			form({ provider_type: 's3', name: ' Uploads ', bucket: 'b', region: 'auto', endpoint: 'https://x.r2.cloudflarestorage.com', access_key: 'AK', secret_key: 'SK', use_ssl: 'true', enabled: 'true', priority: '2', local_public_unsigned: 'true' }),
			true,
		);
		expect(r).toEqual({
			body: {
				provider_type: 's3', name: 'Uploads', bucket: 'b', region: 'auto', endpoint: 'https://x.r2.cloudflarestorage.com',
				access_key: 'AK', secret_key: 'SK', use_ssl: true, path_style: false, enabled: true, priority: 2,
				local_public_unsigned: false,
			},
		});
	});

	it('refuses a create missing a required field and names it', () => {
		expect(providerBodyFrom(form({ provider_type: 's3', name: 'x', bucket: 'b', region: 'r', access_key: 'AK' }), true)).toEqual({ error: 'Secret access key is required.' });
		expect(providerBodyFrom(form({ provider_type: 'nope', name: 'x' }), true)).toEqual({ error: 'Choose a provider type.' });
		expect(providerBodyFrom(form({ provider_type: 'local' }), true)).toEqual({ error: 'Give the provider a name.' });
	});

	it('keeps the stored credentials on an edit that leaves them empty', () => {
		const r = providerBodyFrom(form({ provider_type: 's3', name: 'x', bucket: 'b', region: 'r' }), false);
		expect('body' in r && r.body).toMatchObject({ bucket: 'b' });
		expect('body' in r && 'secret_key' in r.body).toBe(false);
	});

	it('lets only a local provider hand out unsigned URLs', () => {
		const r = providerBodyFrom(form({ provider_type: 'local', name: 'disk', endpoint: '/data', local_public_unsigned: 'true' }), true);
		expect('body' in r && r.body.local_public_unsigned).toBe(true);
	});

	it('treats every secret and the access key as a credential', () => {
		for (const fields of Object.values(PROVIDER_FIELDS)) {
			for (const f of fields) expect(isCredential(f)).toBe(f.secret === true || f.key === 'access_key');
		}
	});
});
