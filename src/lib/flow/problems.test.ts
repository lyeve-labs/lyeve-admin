import { describe, expect, it } from 'vitest';
import { describeError } from './problems';
import { fixtureCatalog, joinFlow } from './fixtures';

describe('describeError', () => {
	it('names the node as its card does and makes the field and the predicate one sentence', () => {
		const p = describeError({ node_id: 'join', path: '/config/left_key', message: 'required' }, joinFlow, fixtureCatalog, 0);
		expect(p.where).toBe('Join');
		expect(p.what).toBe('Left key is required.');
	});

	it('names the flow settings and the trigger', () => {
		expect(describeError({ path: '/settings/timeout', message: 'must be a duration such as 30s or 1m' }, joinFlow, fixtureCatalog, 1)).toMatchObject({
			where: 'Flow settings',
			what: 'Timeout must be a duration such as 30s or 1m.',
		});
		expect(describeError({ node_id: 'trigger', path: '/config/auth', message: 'required' }, joinFlow, fixtureCatalog, 2).where).toBe('Trigger');
	});

	it('numbers a connection from one and keeps a message that needs no field', () => {
		const p = describeError({ path: '/edges/0', message: 'an edge cannot loop back to its own node' }, joinFlow, fixtureCatalog, 3);
		expect(p).toMatchObject({ where: 'Connection 1', what: 'An edge cannot loop back to its own node.' });
	});

	it('keeps a message that names its own subject as it is', () => {
		const p = describeError({ node_id: 'join', path: '/type', message: 'node type "x" is not available on this instance' }, joinFlow, fixtureCatalog, 5);
		expect(p.what).toBe('Node type "x" is not available on this instance.');
	});

	it('falls back to the id of a node the draft no longer has', () => {
		expect(describeError({ node_id: 'gone', path: '/type', message: 'unsupported' }, joinFlow, fixtureCatalog, 4)).toMatchObject({
			where: 'gone',
			what: 'Type: unsupported.',
		});
	});
});
