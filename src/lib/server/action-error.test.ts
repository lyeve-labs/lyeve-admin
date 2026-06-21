import { describe, it, expect } from 'vitest';
import { ApiError } from '@lyeve-labs/client';
import { actionError } from './action-error';

const FALLBACK = 'Failed to create webhook';

describe('actionError', () => {
	it('relays a 400 validation message so the operator knows what to change', () => {
		const err = new ApiError(400, 'field_map is required and must not be empty');
		expect(actionError(err, FALLBACK)).toBe('field_map is required and must not be empty');
	});

	it('relays 422 as well, which is what the engine uses for schema validation', () => {
		const err = new ApiError(422, 'schema name is required');
		expect(actionError(err, FALLBACK)).toBe('schema name is required');
	});

	it('relays a 409 conflict', () => {
		const err = new ApiError(409, 'a webhook with that name already exists');
		expect(actionError(err, FALLBACK)).toBe('a webhook with that name already exists');
	});

	// 501 is the engine stating an operation is not available here, written for
	// the operator. Swallowing it would leave a generic failure with no way to
	// tell a real failure from something that is not possible here.
	it('relays a 501, which states what is unavailable', () => {
		const err = new ApiError(501, 'this plugin does not expose its migrations');
		expect(actionError(err, FALLBACK)).toBe('this plugin does not expose its migrations');
	});

	// Other 5xx bodies can carry driver text, table names or internal paths, none
	// of which may reach a response the browser renders.
	it('does not relay a 500', () => {
		const err = new ApiError(500, 'pq: relation "sys_webhooks" does not exist');
		expect(actionError(err, FALLBACK)).toBe(FALLBACK);
	});

	it('does not relay a 503 from an unavailable replica', () => {
		const err = new ApiError(503, 'read replica unavailable: dial tcp 10.0.0.7:5432: refused');
		expect(actionError(err, FALLBACK)).toBe(FALLBACK);
	});

	it('does not relay a transport failure', () => {
		expect(actionError(new TypeError('fetch failed'), FALLBACK)).toBe(FALLBACK);
	});

	it('falls back for a non-Error throw', () => {
		expect(actionError('something', FALLBACK)).toBe(FALLBACK);
		expect(actionError(null, FALLBACK)).toBe(FALLBACK);
		expect(actionError(undefined, FALLBACK)).toBe(FALLBACK);
	});

	it('falls back when a 4xx carries no message', () => {
		expect(actionError(new ApiError(400, ''), FALLBACK)).toBe(FALLBACK);
		expect(actionError(new ApiError(400, '   '), FALLBACK)).toBe(FALLBACK);
	});

	// The client uses the status as the message when the body has no error field,
	// which is not something worth showing anyone.
	it('falls back when the message is just the status code', () => {
		expect(actionError(new ApiError(400, '400'), FALLBACK)).toBe(FALLBACK);
	});

	it('trims surrounding whitespace off a relayed message', () => {
		expect(actionError(new ApiError(400, '  name is required  '), FALLBACK)).toBe(
			'name is required'
		);
	});
});
