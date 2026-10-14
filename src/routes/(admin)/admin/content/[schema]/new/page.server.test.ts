import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Cookies } from '@sveltejs/kit';

const client = vi.hoisted(() => ({
	post: vi.fn(async (_path: string, _body: unknown) => ({ id: 'e1' })),
}));

// Reads and writes share one session client, as they do in the load and the
// action. Writes land in `client` and reads in `reads`.
vi.mock('$lib/server/authz', () => ({
	requireUser: vi.fn(async () => ({ id: 'u1' })),
	authedClient: vi.fn(() => ({ post: client.post, get: reads.get })),
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
const reads = vi.hoisted(() => ({ get: vi.fn(async (_path: string): Promise<unknown> => ({})) }));
vi.mock('@lyeve-labs/client', () => ({
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

import { isHttpError } from '@sveltejs/kit';
import { actions, load } from './+page.server';

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

describe('opening the new entry form', () => {
	const localizedSchema = { name: 'surveys', display_name: 'Surveys', with_localization: true, fields: [] };

	type Opened = {
		locales: { ok: boolean; value?: unknown } | null;
		relations: Record<string, { items: unknown[]; total: number; failed: boolean }>;
	};

	function open(running: string[], roles: string[] = ['admin']) {
		return Promise.resolve(
			load({
				fetch: vi.fn(),
				cookies: cookies(),
				params: { schema: 'surveys' },
				url: new URL('http://localhost/admin/content/surveys/new'),
				parent: async () => ({ plugins: { state: 'named', running, withheld: [] }, user: { id: 'u1', roles } }),
			} as never),
		) as Promise<Opened>;
	}

	const relatedSchema = {
		name: 'surveys',
		display_name: 'Surveys',
		fields: [{ name: 'author', field_type: 'relation', relation_type: 'belongs_to', relation_to: 'author' }],
	};

	beforeEach(() => {
		reads.get.mockReset();
		rest.getSchema.mockClear();
	});

	it('opens a localized schema without the localization plugin, and offers no locale', async () => {
		rest.getSchema.mockResolvedValueOnce(localizedSchema as never);

		const data = await open([]);

		expect(data.locales).toBeNull();
		expect(reads.get).not.toHaveBeenCalled();
	});

	it('keeps the form when the locales cannot be read, and says so', async () => {
		rest.getSchema.mockResolvedValueOnce(localizedSchema as never);
		reads.get.mockRejectedValueOnce(new FakeApiError('down', 503));

		const data = await open(['localization']);

		expect(data.locales?.ok).toBe(false);
	});

	it('offers the enabled locales while the plugin runs', async () => {
		rest.getSchema.mockResolvedValueOnce(localizedSchema as never);
		reads.get.mockResolvedValueOnce({ default_locale: 'en', enabled_locales: ['en', 'fr'] });

		const data = await open(['localization']);

		expect(data.locales).toEqual({
			ok: true,
			value: [
				{ code: 'en', name: 'en', is_default: true },
				{ code: 'fr', name: 'fr', is_default: false },
			],
		});
	});

	it('hands the media picker null when the library could not be read', async () => {
		const withMedia = { name: 'surveys', display_name: 'Surveys', fields: [{ name: 'cover', field_type: 'media' }] };
		rest.getSchema.mockResolvedValueOnce(withMedia as never);
		reads.get.mockRejectedValueOnce(new FakeApiError('down', 503));
		const failed = (await open([])) as unknown as { mediaChoices: unknown };
		expect(failed.mediaChoices).toBeNull();

		rest.getSchema.mockResolvedValueOnce(withMedia as never);
		reads.get.mockResolvedValueOnce({ data: [] });
		const empty = (await open([])) as unknown as { mediaChoices: unknown };
		expect(empty.mediaChoices).toEqual([]);
	});

	it('reports an outage as an outage, not as a schema that is not there', async () => {
		rest.getSchema.mockRejectedValueOnce(new FakeApiError('down', 503) as never);

		const thrown = await open([]).catch((err: unknown) => err);

		expect(isHttpError(thrown) && thrown.status).toBe(503);
	});

	it('refuses an editor, whose Create the engine would refuse, before reading anything', async () => {
		const thrown = await open([], ['editor']).catch((err: unknown) => err);

		expect(isHttpError(thrown) && thrown.status).toBe(403);
		expect(rest.getSchema).not.toHaveBeenCalled();
	});

	it('reads each related collection from the admin store, one page of 500', async () => {
		rest.getSchema.mockResolvedValueOnce(relatedSchema as never);
		reads.get.mockResolvedValueOnce({ data: [{ id: 'a1', title: 'Ada' }], total_count: 900 });

		const data = await open([]);

		const asked = new URL(String(reads.get.mock.calls[0][0]), 'http://localhost');
		expect(asked.pathname).toBe('/api/admin/content');
		expect(asked.searchParams.get('schema')).toBe('author');
		expect(asked.searchParams.get('limit')).toBe('500');
		expect(data.relations.author).toMatchObject({ total: 900, failed: false });
		expect(data.relations.author.items).toHaveLength(1);
	});

	it('marks a related collection whose read failed, rather than calling it empty', async () => {
		rest.getSchema.mockResolvedValueOnce(relatedSchema as never);
		reads.get.mockRejectedValueOnce(new FakeApiError('down', 503));

		const data = await open([]);

		expect(data.relations.author).toEqual({ items: [], total: 0, failed: true });
	});
});
