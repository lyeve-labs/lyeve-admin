import { describe, expect, it, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import { actions, load } from './+page.server';

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function mockCookies(): Cookies {
	return {
		get: vi.fn((name: string) => (name === 'csrf' ? 'csrf-token' : 'tok')),
		set: vi.fn(),
		delete: vi.fn(),
		getAll: vi.fn(() => []),
		serialize: vi.fn(() => ''),
	} as unknown as Cookies;
}

type Route = (url: string, init?: RequestInit) => Response | Promise<Response>;

/** A fetch that answers by path, recording every call. */
function fetchFor(routes: Record<string, Route>) {
	const calls: { url: string; init?: RequestInit }[] = [];
	const fetch = vi.fn(async (url: string, init?: RequestInit) => {
		const asked = String(url);
		calls.push({ url: asked, init });
		if (asked.includes('/auth/me')) return json({ id: 'u1', roles: ['super_admin'], disabled: false });
		for (const [needle, route] of Object.entries(routes)) {
			if (asked.includes(needle)) return route(asked, init);
		}
		return json({ error: 'no route' }, 404);
	}) as unknown as typeof globalThis.fetch;
	return { fetch, calls };
}

const presets = [
	{ id: 'notes', name: 'Notes', description: 'Short notes and their tags.', schemas: [{ name: 'notes', fields: [] }, { name: 'note_tags', fields: [] }] },
];

function loadEvent(routes: Record<string, Route>) {
	const { fetch, calls } = fetchFor(routes);
	return {
		calls,
		event: {
			fetch,
			cookies: mockCookies(),
			parent: async () => ({ user: { roles: ['super_admin'] } }),
		} as never,
	};
}

function actionEvent(routes: Record<string, Route>, id: string) {
	const { fetch, calls } = fetchFor(routes);
	const form = new FormData();
	form.set('id', id);
	return {
		calls,
		event: {
			fetch,
			cookies: mockCookies(),
			request: { formData: async () => form },
			url: new URL('http://localhost/admin/schema'),
			params: {},
		} as never,
	};
}

type Loaded = { schemas: { name: string }[]; presets: { id: string }[]; presetsError: string | null };

const schemaRoutes: Record<string, Route> = {
	'/api/admin/schemas/presets': () => json({ presets }),
	'/api/admin/schemas/canvas-layout': () => json({ positions: {}, licensed: false }),
	'/stats': () => json({ rows: 3 }),
	'/api/admin/schemas': () => json([{ name: 'posts', display_name: 'Posts', fields: [] }]),
};

describe('admin/schema load', () => {
	it('reads the presets beside the schemas', async () => {
		const { event } = loadEvent(schemaRoutes);
		const out = (await load(event)) as unknown as Loaded;
		expect(out.schemas.map((s) => s.name)).toEqual(['posts']);
		expect(out.presets.map((p) => p.id)).toEqual(['notes']);
		expect(out.presetsError).toBeNull();
	});

	it('keeps the page when the presets route is missing, and says so when it fails', async () => {
		const missing = loadEvent({ ...schemaRoutes, '/api/admin/schemas/presets': () => json({ error: 'not found' }, 404) });
		const withoutRoute = (await load(missing.event)) as unknown as Loaded;
		expect(withoutRoute.presets).toEqual([]);
		expect(withoutRoute.presetsError).toBeNull();

		const failing = loadEvent({ ...schemaRoutes, '/api/admin/schemas/presets': () => json({ error: 'db down' }, 503) });
		const failed = (await load(failing.event)) as unknown as Loaded;
		expect(failed.presets).toEqual([]);
		expect(failed.presetsError).toBe('The presets could not be loaded.');
	});
});

describe('admin/schema load reads what this install allows', () => {
	type Allowed = { canSavePresets: boolean; canvas: { positions: Record<string, unknown>; licensed: boolean } };

	it('takes the canvas and the preset save from the plugin', async () => {
		const { event } = loadEvent({
			...schemaRoutes,
			'/api/admin/schemas/presets': () => json({ presets, can_save: true }),
			'/api/admin/schemas/canvas-layout': () => json({ positions: { posts: { x: 10, y: 20 }, bad: { x: 'a' } }, licensed: true }),
		});
		const out = (await load(event)) as unknown as Allowed;
		expect(out.canSavePresets).toBe(true);
		expect(out.canvas).toEqual({ positions: { posts: { x: 10, y: 20 } }, licensed: true });
	});

	it('draws no canvas and offers no save when the plugin does not say so', async () => {
		const { event } = loadEvent({ ...schemaRoutes, '/api/admin/schemas/canvas-layout': () => json({ error: 'db down' }, 503) });
		const out = (await load(event)) as unknown as Allowed;
		expect(out.canSavePresets).toBe(false);
		expect(out.canvas).toEqual({ positions: {}, licensed: false });
	});
});

describe('admin/schema layout action', () => {
	it('sends the whole layout and keeps only real positions', async () => {
		const { event, calls } = formEvent(
			{ '/api/admin/schemas/canvas-layout': () => json({ positions: {} }) },
			{ positions: JSON.stringify({ posts: { x: 1, y: 2 }, junk: 'x' }) },
		);
		expect(await actions.saveLayout(event)).toEqual({ layoutSaved: true });
		const put = calls.find((c) => c.url.endsWith('/api/admin/schemas/canvas-layout'));
		expect(put?.init?.method).toBe('PUT');
		expect(JSON.parse(String(put?.init?.body))).toEqual({ positions: { posts: { x: 1, y: 2 } } });
	});

	it('relays the license refusal', async () => {
		const { event } = formEvent(
			{ '/api/admin/schemas/canvas-layout': () => json({ error: 'payment_required', plugin: 'schema', feature: 'feature:example_feature' }, 402) },
			{ positions: '{}' },
		);
		expect(await actions.saveLayout(event)).toMatchObject({ status: 402, data: { refused: { kind: 'feature' } } });
	});
});

describe('admin/schema preset action', () => {
	it('posts the preset id and answers with the schemas the engine created', async () => {
		const { event, calls } = actionEvent(
			{ '/api/admin/schemas/presets/notes': () => json({ created: ['notes', 'note_tags'] }, 201) },
			'notes'
		);
		const out = await actions.preset(event);
		expect(out).toEqual({ preset: 'notes', created: ['notes', 'note_tags'] });
		const post = calls.find((c) => c.url.includes('/api/admin/schemas/presets/notes'));
		expect(post?.init?.method).toBe('POST');
	});

	it('relays a 409 beside the preset it refused', async () => {
		const { event } = actionEvent(
			{ '/api/admin/schemas/presets/notes': () => json({ error: 'schema "notes" already exists' }, 409) },
			'notes'
		);
		const out = await actions.preset(event);
		expect(out).toMatchObject({ status: 409, data: { error: 'schema "notes" already exists', preset: 'notes' } });
	});

	it('names an unknown preset as one the install does not ship', async () => {
		const { event } = actionEvent({ '/api/admin/schemas/presets/blog': () => json({ error: 'not found' }, 404) }, 'blog');
		const out = await actions.preset(event);
		expect(out).toMatchObject({ status: 404, data: { error: 'This install does not ship this preset.', preset: 'blog' } });
	});

	it('refuses an empty id before asking the engine', async () => {
		const { event, calls } = actionEvent({}, '');
		const out = await actions.preset(event);
		expect(out).toMatchObject({ status: 400 });
		expect(calls.filter((c) => c.url.includes('/presets'))).toEqual([]);
	});
});

function formEvent(routes: Record<string, Route>, fields: Record<string, string>) {
	const { fetch, calls } = fetchFor(routes);
	const form = new FormData();
	for (const [k, v] of Object.entries(fields)) form.set(k, v);
	return {
		calls,
		event: {
			fetch,
			cookies: mockCookies(),
			request: { formData: async () => form },
			url: new URL('http://localhost/admin/schema'),
			params: {},
		} as never,
	};
}

const posts = { name: 'posts', display_name: 'Posts', fields: [{ name: 'headline', field_type: 'text', required: false, unique: false, indexed: false }] };

describe('admin/schema save action', () => {
	it('renames the field through the rename route before it saves the definition', async () => {
		const { event, calls } = formEvent(
			{
				'/fields/title/rename': () => json({ schema: 'posts', old_field: 'title', new_field: 'headline' }),
				'/api/admin/schemas': () => json(posts),
			},
			{ schema: JSON.stringify(posts), original: 'posts', renames: JSON.stringify([{ from: 'title', to: 'headline' }]) },
		);
		const out = await actions.save(event);
		expect(out).toEqual({ scope: 'save', saved: posts });
		const writes = calls.filter((c) => c.init?.method === 'PUT' || c.init?.method === 'POST');
		expect(writes.map((c) => `${c.init?.method} ${new URL(c.url, 'http://x').pathname}`)).toEqual([
			'PUT /api/admin/schemas/posts/fields/title/rename',
			'POST /api/admin/schemas',
		]);
		expect(JSON.parse(String(writes[0].init?.body))).toEqual({ new_name: 'headline' });
	});

	it('says which renames already ran when the save after them fails', async () => {
		const { event } = formEvent(
			{
				'/fields/title/rename': () => json({}),
				'/api/admin/schemas': () => json({ error: 'invalid schema: field "x"' }, 422),
			},
			{ schema: JSON.stringify(posts), original: 'posts', renames: JSON.stringify([{ from: 'title', to: 'headline' }]) },
		);
		const out = (await actions.save(event)) as { status: number; data: { error: string; renamed: unknown[] } };
		expect(out.status).toBe(422);
		expect(out.data.error).toBe('invalid schema: field "x" The renames went through: title to headline.');
		expect(out.data.renamed).toEqual([{ from: 'title', to: 'headline' }]);
	});

	it('refuses a machine name edited in the definition of a saved schema', async () => {
		const { event, calls } = formEvent({}, { schema: JSON.stringify(posts), original: 'articles', renames: '[]' });
		const out = (await actions.save(event)) as { status: number };
		expect(out.status).toBe(400);
		expect(calls.filter((c) => c.init?.method === 'POST')).toEqual([]);
	});

	it('repeats a save once when another instance holds the DDL lock', async () => {
		vi.useFakeTimers();
		try {
			let tries = 0;
			const { event } = formEvent(
				{
					'/api/admin/schemas': () => (++tries === 1 ? json({ error: 'another instance is applying DDL' }, 503) : json(posts)),
				},
				{ schema: JSON.stringify(posts), original: '', renames: '[]' },
			);
			const pending = actions.save(event);
			await vi.advanceTimersByTimeAsync(1000);
			expect(await pending).toEqual({ scope: 'save', saved: posts });
			expect(tries).toBe(2);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('admin/schema preview, delete and rename actions', () => {
	it('answers the statements a save would run', async () => {
		const statements = [{ description: 'add column', sql: 'ALTER TABLE _posts ADD headline TEXT' }];
		const { event } = formEvent({ '/preview-ddl': () => json({ statements }) }, { schema: JSON.stringify(posts), intent: 'save' });
		expect(await actions.preview(event)).toEqual({ scope: 'preview', intent: 'save', statements });
	});

	it('hides a server failure behind a sentence', async () => {
		const { event } = formEvent({ '/api/admin/schemas/posts': () => json({ error: 'pq: relation missing' }, 500) }, { name: 'posts' });
		const out = (await actions.delete(event)) as { data: { error: string } };
		expect(out.data.error).toBe('The schema could not be deleted.');
	});

	it('moves the table through the rename route', async () => {
		const renamed = { ...posts, name: 'articles' };
		const { event, calls } = formEvent({ '/posts/rename': () => json(renamed) }, { from: 'posts', to: 'articles' });
		expect(await actions.rename(event)).toEqual({ scope: 'rename', from: 'posts', saved: renamed });
		expect(calls.some((c) => c.init?.method === 'PUT' && c.url.includes('/api/admin/schemas/posts/rename'))).toBe(true);
	});
});

describe('admin/schema preview of a save with renames', () => {
	it('asks the engine about the renamed fields under their old names', async () => {
		const { event, calls } = formEvent(
			{ '/preview-ddl': () => json({ statements: [] }) },
			{ schema: JSON.stringify(posts), intent: 'save', renames: JSON.stringify([{ from: 'title', to: 'headline' }]) },
		);
		expect(await actions.preview(event)).toEqual({ scope: 'preview', intent: 'save', statements: [] });
		const sent = JSON.parse(String(calls.find((c) => c.url.includes('/preview-ddl'))?.init?.body));
		expect(sent.fields.map((f: { name: string }) => f.name)).toEqual(['title']);
	});
});

describe('admin/schema history and queued changes', () => {
	it('reads the history of one schema', async () => {
		const entries = [{ version: 2, description: 'drop column sku', up_sql: 'ALTER TABLE _posts DROP COLUMN sku', state: 'pending', created_at: '2026-09-24T00:00:00Z' }];
		const { event } = formEvent({ '/posts/history': () => json({ entries, pending: 1, limit: 200 }) }, { name: 'posts' });
		expect(await actions.history(event)).toEqual({ scope: 'history', name: 'posts', entries, pending: 1, limit: 200 });
	});

	it('says so when the engine serves no history route', async () => {
		const { event } = formEvent({ '/posts/history': () => json({ error: 'not found' }, 404) }, { name: 'posts' });
		const out = (await actions.history(event)) as { status: number; data: { error: string } };
		expect(out.status).toBe(404);
		expect(out.data.error).toMatch(/no history/);
	});

	it('applies the queue for that schema only', async () => {
		const { event, calls } = formEvent({ '/posts/apply-pending': () => json({ applied: 2, canceled: 1 }) }, { name: 'posts' });
		expect(await actions.applyPending(event)).toEqual({ scope: 'applyPending', name: 'posts', applied: 2, canceled: 1 });
		expect(calls.some((c) => c.init?.method === 'POST' && c.url.includes('/api/admin/schemas/posts/apply-pending'))).toBe(true);
	});
});

describe('admin/schema import', () => {
	const plan = { schemas: [{ name: 'articles', action: 'create', ddl: ['CREATE TABLE _articles (...)'] }] };

	it('asks for the plan first and sends the paste with its source', async () => {
		const { event, calls } = formEvent(
			{ '/api/admin/schemas/import': () => json({ applied: false, plan, notes: [], renamed: {} }) },
			{ text: '{"schemas":[]}', source: 'strapi', apply: 'false' },
		);
		const out = await actions.import(event);
		expect(out).toEqual({ scope: 'import', applied: false, plan, renamed: {}, notes: [] });
		const post = calls.find((c) => c.url.includes('/api/admin/schemas/import'));
		expect(post?.url).toContain('from=strapi');
		expect(post?.url).not.toContain('apply=true');
		expect((post?.init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
	});

	it('runs the plan when asked to apply', async () => {
		const { event, calls } = formEvent(
			{ '/api/admin/schemas/import': () => json({ applied: true, plan }) },
			{ text: 'schemas: []', source: 'lyeve', apply: 'true' },
		);
		expect(await actions.import(event)).toMatchObject({ applied: true });
		expect(calls.find((c) => c.url.includes('/import'))?.url).toContain('apply=true');
	});

	it('relays what the engine says is wrong with the file and hides a server failure', async () => {
		const bad = formEvent({ '/api/admin/schemas/import': () => json({ error: 'line 3: unknown field_type "strng"' }, 422) }, { text: 'x', source: 'lyeve' });
		expect(((await actions.import(bad.event)) as { data: { error: string } }).data.error).toBe('line 3: unknown field_type "strng"');
		const broken = formEvent({ '/api/admin/schemas/import': () => json({ error: 'pq: deadlock' }, 500) }, { text: 'x', source: 'lyeve' });
		expect(((await actions.import(broken.event)) as { data: { error: string } }).data.error).toBe('The definitions could not be imported.');
	});

	it('refuses an empty form and an unknown source before calling the engine', async () => {
		const empty = formEvent({}, { source: 'lyeve' });
		expect(((await actions.import(empty.event)) as { status: number }).status).toBe(400);
		const odd = formEvent({}, { text: 'x', source: 'drupal' });
		expect(((await actions.import(odd.event)) as { status: number }).status).toBe(400);
		expect([...empty.calls, ...odd.calls].filter((c) => c.url.includes('/import'))).toEqual([]);
	});
});

describe('admin/schema load streams the row counts', () => {
	it('answers the schemas before the counts, and leaves out a count that failed', async () => {
		const { event } = loadEvent({
			'/api/admin/schemas/presets': () => json({ presets: [] }),
			'/api/admin/schemas/posts/stats': () => json({ rows: 3 }),
			'/api/admin/schemas/pages/stats': () => json({ error: 'x' }, 503),
			'/api/admin/schemas': () => json([{ name: 'posts', fields: [] }, { name: 'pages', fields: [] }]),
		});
		const out = (await load(event)) as unknown as { rowCounts: Promise<Record<string, number>>; isSuperAdmin: boolean };
		expect(out.rowCounts).toBeInstanceOf(Promise);
		expect(await out.rowCounts).toEqual({ posts: 3 });
		expect(out.isSuperAdmin).toBe(true);
	});
});

describe('admin/schema saved presets', () => {
	it('saves a preset from a URL and sends only the URL', async () => {
		const { event, calls } = formEvent(
			{ '/api/admin/schemas/presets': () => json({ id: 'blog', name: 'Blog', schemas: [], source: 'saved' }, 201) },
			{ url: 'https://example.com/blog.json' },
		);
		const out = await actions.savePreset(event);
		expect(out).toEqual({ savedPreset: 'blog' });
		const post = calls.find((c) => c.url.endsWith('/api/admin/schemas/presets'));
		expect(post?.init?.method).toBe('POST');
		expect(JSON.parse(String(post?.init?.body))).toEqual({ url: 'https://example.com/blog.json' });
	});

	it('saves a pasted document as the document', async () => {
		const { event, calls } = formEvent(
			{ '/api/admin/schemas/presets': () => json({ id: 'blog', name: 'Blog', schemas: [] }, 201) },
			{ document: 'id: blog' },
		);
		await actions.savePreset(event);
		const post = calls.find((c) => c.url.endsWith('/api/admin/schemas/presets'));
		expect(JSON.parse(String(post?.init?.body))).toEqual({ document: 'id: blog' });
	});

	it('refuses nothing, and both, before asking the engine', async () => {
		for (const fields of [{}, { url: 'https://example.com/x', document: '{}' }] as Record<string, string>[]) {
			const { event, calls } = formEvent({}, fields);
			expect(await actions.savePreset(event)).toMatchObject({ status: 400 });
			expect(calls.filter((c) => c.url.includes('/presets'))).toEqual([]);
		}
	});

	it('names a built-in id and an unreachable URL for what they are', async () => {
		const clash = formEvent({ '/api/admin/schemas/presets': () => json({ error: 'a built-in preset already uses that id' }, 409) }, { document: '{}' });
		expect(await actions.savePreset(clash.event)).toMatchObject({ status: 409, data: { saveError: expect.stringContaining('built-in') } });
		const gone = formEvent({ '/api/admin/schemas/presets': () => json({ error: 'bad gateway' }, 502) }, { url: 'https://example.com/x' });
		expect(await actions.savePreset(gone.event)).toMatchObject({ status: 502 });
	});

	it('relays the license refusal of a save', async () => {
		const { event } = formEvent(
			{ '/api/admin/schemas/presets': () => json({ error: 'payment_required', plugin: 'schema', feature: 'feature:example_feature' }, 402) },
			{ url: 'https://example.com/blog.json' },
		);
		expect(await actions.savePreset(event)).toMatchObject({ status: 402, data: { refused: { kind: 'feature' }, saveError: expect.any(String) } });
	});

	it('deletes a saved preset by id', async () => {
		const { event, calls } = formEvent({ '/api/admin/schemas/presets/blog': () => new Response(null, { status: 204 }) }, { id: 'blog' });
		expect(await actions.deletePreset(event)).toEqual({ deletedPreset: 'blog' });
		expect(calls.find((c) => c.url.includes('/presets/blog'))?.init?.method).toBe('DELETE');
	});
});
