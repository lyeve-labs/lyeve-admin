import { describe, expect, it } from 'vitest';
import { flowEndpoints, slugError, triggerProtocols } from './endpoints';

const origin = 'https://cms.example.com';
const id = '0b6c1f5e-1111-4222-8333-944455556666';

function http(config: Record<string, unknown>, slug = 'orders-sync') {
	return { slug, trigger: { type: 'trigger.http', config } };
}

describe('flowEndpoints', () => {
	it('lists the REST URL of a signed-in flow and nothing else by default', () => {
		const eps = flowEndpoints(origin, id, http({ method: 'POST', auth: 'auth' }));
		expect(eps.map((e) => [e.key, e.value])).toEqual([['rest', `${origin}/api/v1/flows/orders-sync`]]);
		expect(eps[0].option).toBeUndefined();
	});

	it('adds the public URL and the custom path of a public flow', () => {
		const eps = flowEndpoints(origin, id, http({ auth: 'public', path: '/api/v1/orders/sync' }));
		expect(eps.map((e) => e.key)).toEqual(['rest', 'public', 'path']);
		expect(eps[1].value).toBe(`${origin}/api/v1/flows/p/${id}`);
		expect(eps[2].value).toBe(`${origin}/api/v1/orders/sync`);
		expect(eps[2].option).toBe('path');
	});

	it('shows each declared transport with the call that reaches it, from the protocols option', () => {
		const eps = flowEndpoints(origin, id, http({ auth: 'auth', protocols: ['graphql', 'grpc', 'realtime'] }));
		expect(eps.map((e) => e.key)).toEqual(['graphql', 'grpc', 'realtime']);
		expect(eps.every((e) => e.option === 'protocols')).toBe(true);
		expect(eps[0].value).toContain('runFlow(slug: "orders-sync"');
		expect(eps[1].value).toContain('FlowService/Run');
		expect(JSON.parse(eps[2].value)).toMatchObject({ type: 'flow.run', slug: 'orders-sync' });
		expect(eps[2].hint).toContain('wss://cms.example.com/api/v1/ws/connect');
	});

	it('follows the slug on the canvas, before it is saved', () => {
		const eps = flowEndpoints(origin, id, http({ auth: 'auth', protocols: ['rest', 'graphql'] }, 'renamed'));
		expect(eps[0].value).toBe(`${origin}/api/v1/flows/renamed`);
		expect(eps[1].value).toContain('"renamed"');
	});

	it('gives an admin flow its invoke URL only, since no transport reaches it', () => {
		const eps = flowEndpoints(origin, id, http({ auth: 'admin', protocols: ['rest', 'grpc'] }));
		expect(eps.map((e) => e.value)).toEqual([`${origin}/api/admin/flows/${id}/invoke`]);
	});

	it('lists the hook URL and the path of a webhook, and nothing for a trigger with no address', () => {
		const hook = flowEndpoints(origin, id, { slug: 's', trigger: { type: 'trigger.webhook', config: { secret: 'x', path: '/api/hooks/pay' } } });
		expect(hook.map((e) => e.value)).toEqual([`${origin}/api/v1/flows/hooks/${id}`, `${origin}/api/hooks/pay`]);
		expect(hook.map((e) => e.option)).toEqual([undefined, 'path']);
		expect(flowEndpoints(origin, id, { slug: 's', trigger: { type: 'trigger.cron', config: {} } })).toEqual([]);
	});
});

describe('triggerProtocols', () => {
	it('reads REST only when none is named, and drops what the engine does not know', () => {
		expect(triggerProtocols({})).toEqual(['rest']);
		expect(triggerProtocols({ protocols: [] })).toEqual(['rest']);
		expect(triggerProtocols({ protocols: ['grpc', 'soap', 'rest'] })).toEqual(['rest', 'grpc']);
	});
});

describe('slugError', () => {
	it.each(['orders', 'orders-v2', 'a', 'o_1'])('accepts %s', (slug) => {
		expect(slugError(slug)).toBeUndefined();
	});
	it.each(['', 'Orders', '9orders', 'has space', 'a'.repeat(41)])('refuses %j', (slug) => {
		expect(slugError(slug)).toBeTruthy();
	});
});
