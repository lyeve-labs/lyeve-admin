import { describe, expect, it } from 'vitest';
import { channelSummary, channelsFrom, hasChannels, hasPaidChannels, isMasked, toChannels } from './alert-channels';

function form(fields: Record<string, string>): FormData {
	const f = new FormData();
	for (const [k, v] of Object.entries(fields)) f.set(k, v);
	return f;
}

describe('alert channels', () => {
	it('reads an answer into typed members and drops the empty ones', () => {
		expect(
			toChannels({ email: ['a@example.com', 3], slack_url: '', webhook_url: 'https://ops.example.com/...beef', webhook_signed: true }),
		).toEqual({ email: ['a@example.com'], webhook_url: 'https://ops.example.com/...beef', webhook_signed: true });
		expect(toChannels(null)).toEqual({});
	});

	it('reads a form under its prefix and never sends webhook_signed', () => {
		expect(
			channelsFrom(form({ x_email: 'a@example.com\nb@example.com', x_discord_url: ' https://d.example.com/a ', x_webhook_signed: 'true' }), 'x_'),
		).toEqual({ email: ['a@example.com', 'b@example.com'], discord_url: 'https://d.example.com/a' });
	});

	it('tells a masked value from a real one', () => {
		expect(isMasked('https://hooks.slack.com/...1a2b')).toBe(true);
		expect(isMasked('...cdef')).toBe(true);
		expect(isMasked('https://hooks.slack.com/services/T0/B0/X')).toBe(false);
	});

	it('separates email from the paid channels', () => {
		expect(hasChannels({ email: ['a@example.com'] })).toBe(true);
		expect(hasPaidChannels({ email: ['a@example.com'] })).toBe(false);
		expect(hasPaidChannels({ pagerduty_routing_key: '...cdef' })).toBe(true);
	});

	it('summarizes a setting for a list row', () => {
		expect(channelSummary({ email: ['a@x.io', 'b@x.io'], slack_url: 's', pagerduty_routing_key: 'p' })).toBe('2 emails, Slack, PagerDuty');
		expect(channelSummary({})).toBe('No channels');
	});
});
