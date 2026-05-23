import { describe, expect, it } from 'vitest';
import { staticGroups, type EndpointDoc } from './reference';

function find(method: string, path: string): EndpointDoc | undefined {
	return staticGroups.flatMap((g) => g.endpoints).find((e) => e.method === method && e.path === path);
}

describe('API reference', () => {
	// The license module documents its own routes through the engine's
	// OpenAPI document, which lists them only on a build that links one.
	it('documents no route of the license module by hand', () => {
		const paths = staticGroups.flatMap((g) => g.endpoints).map((e) => e.path);
		expect(paths.filter((p) => p.startsWith('/api/admin/license'))).toEqual([]);
	});

	it('shows whether a license module is linked in the entitlements example', () => {
		const ex = find('GET', '/api/admin/entitlements')?.response?.example ?? '';
		expect(ex).toContain('"license_module": true');
		expect(ex).toContain('"expires_at"');
		expect(ex).not.toContain('"license_source"');
	});

	it('lists the schema import', () => {
		expect(find('POST', '/api/admin/schemas/import')?.description).toMatch(/application\/yaml/);
	});

	// Setup mode answers before the router exists, so its status read is in no
	// document the engine serves, and the reference needs a signed-in admin,
	// which setup mode has none of.
	it('leaves out the setup mode status read', () => {
		expect(find('GET', '/api/admin/setup/status')).toBeUndefined();
	});
});
