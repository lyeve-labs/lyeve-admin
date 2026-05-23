import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Cookies } from '@sveltejs/kit';

const client = vi.hoisted(() => ({
	post: vi.fn(async (_path: string, _body: unknown) => ({ id: 'e1' })),
}));

vi.mock('$lib/server/authz', () => ({
	requireUser: vi.fn(async () => ({ id: 'u1' })),
	authedClient: vi.fn(() => client),
	stripProtectedFields: (d: Record<string, unknown>) => d,
}));

/** actionError relays a 4xx reason only when the throw is the client's own
    error type, so the fake has to be that type. */
const { FakeApiError } = vi.hoisted(() => ({
	FakeApiError: class extends Error {
		status: number;
		constructor(message: string, status: number) {
			super(message);
			this.status = status;
		}
	},
}));
vi.mock('@lyeve-labs/client', () => ({
	createClient: vi.fn(() => ({})),
	ApiError: FakeApiError,
}));

const rest = vi.hoisted(() => ({
	getSchema: vi.fn(async () => ({
		name: 'surveys',
		display_name: 'Surveys',
		fields: [
			{ name: 'title', field_type: 'text' },
			{ name: 'active', field_type: 'boolean' },
		],
	})),
	listContent: vi.fn(async () => []),
}));
vi.mock('@lyeve-labs/client-rest', () => rest);

const relations = vi.hoisted(() => ({
	// Takes the event, not a fetch and a token: the CSRF header the write needs
	// is built from the event's cookies in one place.
	setRelations: vi.fn(
		async (_event: unknown, _entryID: string, _fieldName: string, _ids: string[]) => {},
	),
}));
vi.mock('$lib/server/content-relations', () => relations);

import { actions } from './+page.server';

function cookies(): Cookies {
	return { get: vi.fn(() => 'tok') } as unknown as Cookies;
}

async function create(data: Record<string, unknown>, m2m?: Record<string, string[]>) {
	const form = new FormData();
	form.set('data', JSON.stringify(data));
	if (m2m) form.set('m2m_relations', JSON.stringify(m2m));
	const event = {
		request: { formData: async () => form },
		params: { schema: 'surveys' },
		fetch: vi.fn(),
		cookies: cookies(),
	};
	// A successful action ends in a redirect, which SvelteKit throws.
	try {
		return { result: await actions.default(event as never) };
	} catch (threw) {
		return { result: undefined, threw };
	}
}

beforeEach(() => {
	client.post.mockClear();
	relations.setRelations.mockClear();
});

describe('creating a content entry', () => {
	/**
	 * Content has two stores. Everything else in this section reads the admin
	 * store. A create posted to the v1 routes would leave the listing it
	 * redirects to showing nothing, and the entry could never be opened again.
	 */
	it('writes to the store the rest of the section reads', async () => {
		await create({ title: 'Contact', active: false });
		expect(client.post).toHaveBeenCalledOnce();
		expect(client.post.mock.calls[0][0]).toBe('/api/admin/content');
	});

	it('sends the schema, an identity and the field values as the body', async () => {
		await create({ title: 'Contact', active: false });
		const body = client.post.mock.calls[0][1] as Record<string, unknown>;
		expect(body.schema).toBe('surveys');
		expect(body.title).toBe('Contact');
		expect(body.slug).toMatch(/^contact-/);
		expect(body.body).toEqual({ title: 'Contact', active: false });
	});

	it('keeps a false boolean in the body', async () => {
		// A field left at its default is a value the operator chose, not an
		// absence: the entry is inactive, and the row has to say so.
		await create({ title: 'Contact', active: false });
		const body = client.post.mock.calls[0][1] as { body: Record<string, unknown> };
		expect(body.body.active).toBe(false);
	});

	it('names no status, so the store opens the entry as a draft', async () => {
		await create({ title: 'Contact' });
		expect(client.post.mock.calls[0][1]).not.toHaveProperty('status');
	});

	it('writes the relations against the id the admin store gave back', async () => {
		await create({ title: 'Contact' }, { tags: ['t1', 't2'] });
		expect(relations.setRelations).toHaveBeenCalledOnce();
		const [event, entryID, fieldName, ids] = relations.setRelations.mock.calls[0];
		// The event carries the session and CSRF cookies. Anything else here
		// sends Bearer alone, which the engine refuses with 403.
		expect(event).toHaveProperty('cookies');
		expect(entryID).toBe('e1');
		expect(fieldName).toBe('tags');
		expect(ids).toEqual(['t1', 't2']);
	});

	it('relays the reason a create was refused', async () => {
		client.post.mockRejectedValueOnce(new FakeApiError('slug already in use', 409));
		const { result } = await create({ title: 'Contact' });
		expect(JSON.stringify(result)).toContain('slug already in use');
	});
});
