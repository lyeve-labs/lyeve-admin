import { describe, expect, it } from 'vitest';
import { alertsFrom, hasChannels, parseEmails } from './cron-alerts';

function form(fields: Record<string, string>): FormData {
	const f = new FormData();
	for (const [k, v] of Object.entries(fields)) f.set(k, v);
	return f;
}

describe('alertsFrom', () => {
	it('leaves the member out when nothing is set and nothing was stored', () => {
		expect(alertsFrom(form({ alert_email: '', alert_threshold: '1' }))).toBeUndefined();
	});

	it('clears a stored setting when every channel is emptied', () => {
		expect(alertsFrom(form({ alerts_stored: 'true', alert_email: '' }))).toBeNull();
	});

	it('sends only the channels that are filled in, with the threshold', () => {
		expect(
			alertsFrom(form({ alert_email: 'a@example.com, b@example.com', alert_slack_url: 'https://hooks.example.com/x', alert_threshold: '3' })),
		).toEqual({ email: ['a@example.com', 'b@example.com'], slack_url: 'https://hooks.example.com/x', failure_threshold: 3 });
	});

	it('sends a PagerDuty routing key as a channel of its own', () => {
		expect(alertsFrom(form({ alert_pagerduty_routing_key: ' ...cdef ' }))).toEqual({
			pagerduty_routing_key: '...cdef',
		});
	});
});

describe('helpers', () => {
	it('splits emails on commas and lines', () => {
		expect(parseEmails('a@x.io\nb@x.io, ,c@x.io')).toEqual(['a@x.io', 'b@x.io', 'c@x.io']);
	});

	it('reads a setting with no channel as none', () => {
		expect(hasChannels({ failure_threshold: 2 })).toBe(false);
		expect(hasChannels({ discord_url: 'https://d.example.com' })).toBe(true);
		expect(hasChannels(null)).toBe(false);
	});
});
