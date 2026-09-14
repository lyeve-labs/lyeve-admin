import { describe, expect, it } from 'vitest';
import { authFieldsOf, authFromForm, secretKept } from './datasources';

describe('http datasource auth', () => {
	it('reads the stored block into form fields and treats anything else as none', () => {
		expect(authFieldsOf({ auth: { type: 'basic', user: 'svc' } })).toMatchObject({ type: 'basic', user: 'svc' });
		expect(authFieldsOf({ auth: { type: 'oauth2_client_credentials', scopes: 'read write' } }).scopes).toBe('read write');
		expect(authFieldsOf({ auth: { type: 'digest' } }).type).toBe('none');
		expect(authFieldsOf({ auth: null }).type).toBe('none');
		expect(authFieldsOf({}).type).toBe('none');
	});

	it('lets a secret stay blank only for the scheme the engine already holds one for', () => {
		expect(secretKept({ has_secret: true, type: 'bearer' }, 'bearer')).toBe(true);
		expect(secretKept({ has_secret: true, type: 'bearer' }, 'basic')).toBe(false);
		expect(secretKept({ has_secret: false, type: 'bearer' }, 'bearer')).toBe(false);
		expect(secretKept({ has_secret: true, type: 'none' }, 'bearer')).toBe(false);
		expect(secretKept(null, 'bearer')).toBe(false);
		expect(secretKept({ has_secret: true, type: 'none' }, 'none')).toBe(false);
	});

	it('leaves a blank secret out and reads none as no block', () => {
		const none = new FormData();
		expect(authFromForm(none)).toEqual({});
		const bearer = new FormData();
		bearer.set('auth_type', 'bearer');
		bearer.set('auth_token', '');
		expect(authFromForm(bearer)).toEqual({ auth: { type: 'bearer' }, secret: undefined });
	});
});
