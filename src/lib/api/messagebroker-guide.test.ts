import { describe, expect, it } from 'vitest';
import { BACKEND_SETTINGS, connectionGuide } from './messagebroker';

describe('connectionGuide', () => {
	it('names the subject shape each backend uses', () => {
		expect(connectionGuide('nats')?.listen).toContain('lyeve.tenant.<tenant>.>');
		expect(connectionGuide('rabbitmq')?.send).toContain('lyeve.events exchange');
		expect(connectionGuide('kafka', 'events.')?.listen).toContain('events.lyeve.tenant.<tenant>.<schema>.<event>');
		expect(connectionGuide('kafka')?.send).toContain('lyeve.lyeve.tenant.<tenant>.<subject>');
	});

	it('has nothing to say while events go nowhere', () => {
		expect(connectionGuide('noop')).toBeNull();
		expect(connectionGuide('')).toBeNull();
	});

	it('lists settings for every backend it guides', () => {
		for (const b of ['nats', 'kafka', 'rabbitmq']) expect(BACKEND_SETTINGS[b].length).toBeGreaterThan(0);
	});
});
