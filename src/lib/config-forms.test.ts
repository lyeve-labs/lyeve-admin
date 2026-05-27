import { describe, expect, it } from 'vitest';
import { pluginSettings, settingForms, settingMatches } from './config-forms';

describe('settingForms', () => {
	it('writes the environment name and the file key', () => {
		expect(settingForms('DATABASE_URL')).toEqual({ env: 'DATABASE_URL=<value>', file: 'database_url: <value>' });
		expect(settingForms('jwt_expiry_secs', '900')).toEqual({ env: 'JWT_EXPIRY_SECS=900', file: 'jwt_expiry_secs: 900' });
	});
});

describe('settingMatches', () => {
	const s = { key: 'JWT_EXPIRY_SECS', description: 'Access token lifetime, in seconds.' };
	it('matches the name or what the setting does', () => {
		expect(settingMatches(s, 'jwt')).toBe(true);
		expect(settingMatches(s, 'token lifetime')).toBe(true);
		expect(settingMatches(s, 'database')).toBe(false);
		expect(settingMatches(s, '  ')).toBe(true);
		expect(settingMatches({ key: 'X' }, 'lifetime')).toBe(false);
	});
});

describe('pluginSettings', () => {
	const listed = [
		{ key: 'SMTP_HOST', source: 'env', editable: false, value: 'mail' },
		{ key: 'JWT_EXPIRY_SECS', source: 'default', editable: true, description: 'Access token lifetime.' },
	];
	const schema = {
		properties: {
			smtp_host: { description: 'The relay host.' },
			'smtp.port': { description: 'The relay port.', default: 587 },
			smtp_password: { description: 'The relay password.', format: 'password' },
		},
	};

	it('adds the keys nothing has read yet, as unset and editable', () => {
		const { settings, keys } = pluginSettings(listed, schema);
		expect(keys).toEqual(['SMTP_HOST', 'SMTP_PORT', 'SMTP_PASSWORD']);
		expect(settings.find((s) => s.key === 'SMTP_PORT')).toMatchObject({ source: 'default', editable: true, default: '587' });
		expect(settings.find((s) => s.key === 'SMTP_PASSWORD')?.secret).toBe(true);
	});

	it('keeps where a listed key came from, and fills only a missing description', () => {
		const { settings } = pluginSettings(listed, schema);
		expect(settings.find((s) => s.key === 'SMTP_HOST')).toMatchObject({ source: 'env', editable: false, value: 'mail', description: 'The relay host.' });
		expect(settings.find((s) => s.key === 'JWT_EXPIRY_SECS')?.description).toBe('Access token lifetime.');
	});

	it('changes nothing without a schema', () => {
		expect(pluginSettings(listed, null)).toEqual({ settings: listed, keys: [] });
	});
});
