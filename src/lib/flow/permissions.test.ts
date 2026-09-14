import { describe, expect, it } from 'vitest';
import { flowGrants, flowResource, flowResourceLabel, flowSlugOf, isFlowResource } from './permissions';

describe('flow resources', () => {
	it('names a flow and tells the two resources from a schema', () => {
		expect(flowResource('send-receipt')).toBe('flow:send-receipt');
		expect(isFlowResource('flows')).toBe(true);
		expect(isFlowResource('flow:send-receipt')).toBe(true);
		expect(isFlowResource('orders')).toBe(false);
		expect(isFlowResource('*')).toBe(false);
		expect(flowSlugOf('flow:send-receipt')).toBe('send-receipt');
		expect(flowSlugOf('flows')).toBeNull();
		expect(flowSlugOf('flow:')).toBeNull();
		expect(flowResourceLabel('flows')).toBe('All flows');
		expect(flowResourceLabel('flow:send-receipt')).toBe('flow send-receipt');
	});
});

describe('flowGrants', () => {
	it('reads the actions the plugin carries on a flow', () => {
		expect(flowGrants(['read', 'update'])).toEqual({ create: false, read: true, update: true, delete: false, activate: false });
		expect(flowGrants([])).toEqual({ create: false, read: false, update: false, delete: false, activate: false });
	});

	it('reads an engine that carries no actions as everything granted, so the engine decides', () => {
		expect(flowGrants(undefined)).toEqual({ create: true, read: true, update: true, delete: true, activate: true });
		expect(flowGrants(null)).toEqual({ create: true, read: true, update: true, delete: true, activate: true });
	});
});
