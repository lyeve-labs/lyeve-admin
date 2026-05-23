import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const introspect = vi.fn();
const listPersisted = vi.fn();
const registerPersisted = vi.fn();
vi.mock('$lib/server/authz', () => ({ authedClient: () => ({}), requireUser: async () => ({}) }));
vi.mock('$lib/api/graphql', async (orig) => ({
	...(await orig<typeof import('$lib/api/graphql')>()),
	introspect: (...a: unknown[]) => introspect(...a),
	listPersisted: (...a: unknown[]) => listPersisted(...a),
	registerPersisted: (...a: unknown[]) => registerPersisted(...a),
}));

const { load, actions } = await import('./+page.server');

const event = (running: string[]) =>
	({ parent: async () => ({ plugins: { state: 'named', running, withheld: [] }, user: { roles: ['admin'] } }) }) as never;

beforeEach(() => {
	vi.clearAllMocks();
});

describe('graphql settings load', () => {
	it('asks nothing while the GraphQL plugin does not run', async () => {
		const data = (await load(event([]))) as { gate: { state: string } };
		expect(data.gate.state).toBe('absent');
		expect(introspect).not.toHaveBeenCalled();
	});

	it('reads the schema and the allowlist apart, so one failing leaves the other', async () => {
		introspect.mockResolvedValue({ roots: { query: [], mutation: [], subscription: [] }, refused: null });
		listPersisted.mockRejectedValue(new Error('down'));
		const data = (await load(event(['graphql']))) as Record<string, unknown>;
		expect(data.gate).toEqual({ state: 'ok' });
		expect(data.roots).not.toBeNull();
		expect(data.persistedError).toBeTruthy();
	});

	it('says the plugin is absent when neither answers 404', async () => {
		introspect.mockRejectedValue(new ApiError(404, 'not found'));
		listPersisted.mockRejectedValue(new ApiError(404, 'not found'));
		const data = (await load(event(['graphql']))) as { gate: { state: string } };
		expect(data.gate.state).toBe('absent');
	});
});

describe('register', () => {
	it('refuses an empty query before asking the engine', async () => {
		const form = new FormData();
		form.set('query', '  ');
		const res = await actions.register({ request: new Request('http://x', { method: 'POST', body: form }) } as never);
		expect((res as { status: number }).status).toBe(400);
		expect(registerPersisted).not.toHaveBeenCalled();
	});
});
