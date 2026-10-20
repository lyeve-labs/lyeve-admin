import { describe, expect, it } from 'vitest';
import { ApiError } from '@lyeve-labs/client';
import {
	deprovisionAction,
	deprovisionLabel,
	deprovisionTone,
	scimGate,
	type ScimProvider,
} from './scim';

function provider(over: Partial<ScimProvider> = {}): ScimProvider {
	return {
		id: 'c1',
		name: 'Azure AD',
		enabled: true,
		tenant_id: 'default',
		attribute_map: {},
		deprovision_on_delete: true,
		deprovision_action: 'disable',
		created_at: '2026-09-01T00:00:00Z',
		updated_at: '2026-09-01T00:00:00Z',
		...over,
	};
}

describe('what happens to a deprovisioned account', () => {
	// The two fields are stored independently, so the action survives the
	// switch being turned off. With the switch off the plugin deletes the
	// account on a directory delete, even when the stored action is disable.
	it('reads both fields, not just the action', () => {
		expect(deprovisionLabel(provider({ deprovision_on_delete: false, deprovision_action: 'disable' })))
			.toBe('Deleted');
		expect(deprovisionTone(provider({ deprovision_on_delete: false, deprovision_action: 'disable' })))
			.toBe('danger');
	});

	it('marks the irreversible option', () => {
		expect(deprovisionLabel(provider({ deprovision_action: 'delete' }))).toBe('Deleted');
		expect(deprovisionTone(provider({ deprovision_action: 'delete' }))).toBe('danger');
		expect(deprovisionLabel(provider({ deprovision_action: 'disable' }))).toBe('Disabled');
		expect(deprovisionTone(provider({ deprovision_action: 'disable' }))).toBe('warn');
	});

	// An unrecognized action reads as the reversible one rather than the
	// destructive one, because guessing wrong in that direction deletes people.
	it('treats anything it does not recognize as a disable', () => {
		expect(deprovisionLabel(provider({ deprovision_action: 'archive' }))).toBe('Disabled');
	});
});

describe('the action the form may send', () => {
	it('accepts the two the engine stores and refuses the rest', () => {
		expect(deprovisionAction('disable')).toBe('disable');
		expect(deprovisionAction('delete')).toBe('delete');
		expect(deprovisionAction('')).toBeNull();
		expect(deprovisionAction('archive')).toBeNull();
	});
});

describe('the gate sorts a refusal by what it means', () => {
	it('tells a 402, a 404 and any other failure apart', () => {
		expect(scimGate(new ApiError(402, 'payment required')).state).toBe('locked');
		expect(scimGate(new ApiError(404, 'not found')).state).toBe('absent');
		expect(scimGate(new ApiError(500, 'internal error')).state).toBe('error');
		expect(scimGate(new ApiError(503, 'database error')).state).toBe('unavailable');
	});

	it('never reports a failed read as an empty list', () => {
		const gate = scimGate(new Error('network'));
		expect(gate.state === 'error' && gate.message).toContain('not a report that none are configured');
	});
});
