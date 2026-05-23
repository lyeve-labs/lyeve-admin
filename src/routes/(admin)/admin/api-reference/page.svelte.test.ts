// @vitest-environment jsdom
import { render, cleanup, fireEvent, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The only call the page makes off the page is to the clipboard, which jsdom
// does not implement and which the copy control's tick depends on.
const clip = vi.hoisted(() => ({ copyText: vi.fn(async (_text: string) => true) }));
vi.mock('$lib/clipboard', () => clip);

import ApiReferencePage from './+page.svelte';
import type { EndpointGroup } from '$lib/api/reference';
import type { PageData } from './$types';

afterEach(cleanup);
beforeEach(() => {
	vi.clearAllMocks();
});

/** Two endpoints. Every row discloses at least its gate and a request preview. */
const groups: EndpointGroup[] = [
	{
		id: 'admin-media',
		label: 'Admin - Media',
		description: 'The media library.',
		server: 'admin',
		baseUrl: '/api/admin',
		endpoints: [
			{
				method: 'GET',
				path: '/api/admin/media',
				summary: 'List media',
				auth: 'bearer-or-cookie',
				params: [
					{ name: 'limit', in: 'query', type: 'int', required: false, description: 'Page size' },
				],
				response: { description: 'A page of items', example: '{ "items": [] }' },
			},
			{
				method: 'POST',
				path: '/api/admin/logout',
				summary: 'End the session',
				auth: 'cookie',
			},
		],
	},
];

function setup() {
	return render(ApiReferencePage, {
		props: { data: { groups, collections: 0, source: 'engine' } as unknown as PageData, form: null },
	});
}

/** The row's disclosure, which is the only control carrying expanded state. */
/** The endpoint rows' disclosures. The nav's own collapse and its plugin fold are not endpoints. */
function disclosures(container: HTMLElement) {
	const nav = container.querySelector('[data-testid="api-reference-nav"]');
	return ([...container.querySelectorAll('button[aria-expanded]')] as HTMLButtonElement[]).filter((b) => !nav?.contains(b));
}

describe('api reference rows', () => {
	it('keeps the copy control outside the disclosure', () => {
		// A row that is itself a role="button" holding the copy button makes the
		// two one tab stop, and a screen reader reaches the row and never the
		// control inside it.
		const { container } = setup();

		const copy = screen.getByRole('button', { name: 'Copy the path /api/admin/media' });
		const [disclosure] = disclosures(container);

		expect(disclosure).toBeTruthy();
		expect(disclosure.contains(copy), 'the copy button sits inside the disclosure').toBe(false);
	});

	it('leaves no element standing in for a button', () => {
		const { container } = setup();

		expect(container.querySelector('[role="button"]')).toBeNull();
	});

	it('gives every endpoint one disclosure, since each carries its gate and a request', () => {
		const { container } = setup();

		expect(disclosures(container)).toHaveLength(2);
	});

	it('opens to the gate and a request a reader can paste', async () => {
		const { container } = setup();
		const [first] = disclosures(container);
		await fireEvent.click(first);
		const panel = document.getElementById(first.getAttribute('aria-controls')!)!;
		expect(panel.textContent).toContain('A bearer token or the admin session cookie');
		const pres = [...panel.querySelectorAll('pre')];
		expect(pres.at(-1)?.textContent).toContain(`curl -X GET 'http://localhost:3002/api/admin/media'`);
	});

	it('shows no summary for a route the document only echoed, and folds the plugins in the rail', () => {
		const withPlugin = [
			...groups,
			{
				id: 'plugin-waf',
				label: 'Plugin \u00b7 waf',
				description: '',
				server: 'admin',
				baseUrl: '/api/admin',
				endpoints: [{ method: 'GET', path: '/api/admin/waf/config', summary: 'GET /api/admin/waf/config', auth: 'bearer-or-cookie' }],
			},
		] as EndpointGroup[];
		const { container, getByRole, queryByRole } = render(ApiReferencePage, {
			props: { data: { groups: withPlugin, collections: 0, source: 'engine' } as unknown as PageData, form: null },
		});
		// The path shows once, not as its own summary beside itself.
		const row = [...container.querySelectorAll('span')].filter((s) => s.textContent?.trim() === 'GET /api/admin/waf/config');
		expect(row).toHaveLength(0);
		const fold = getByRole('button', { name: /Plugins \(1\)/ });
		expect(fold.getAttribute('aria-expanded')).toBe('false');
		expect(queryByRole('button', { name: 'waf' })).toBeNull();
	});

	it('says when it is showing the catalog instead of the engine', () => {
		const { container } = render(ApiReferencePage, {
			props: { data: { groups, collections: 0, source: 'catalog' } as unknown as PageData, form: null },
		});
		expect(container.textContent).toContain('Showing the built-in catalog');
	});

	it('reports the disclosure state and names the panel it opens', async () => {
		const { container } = setup();
		const [disclosure] = disclosures(container);

		expect(disclosure.getAttribute('aria-expanded')).toBe('false');
		expect(
			disclosure.getAttribute('aria-controls'),
			'a collapsed row names a panel that is not on the page',
		).toBeNull();

		await fireEvent.click(disclosure);

		expect(disclosure.getAttribute('aria-expanded')).toBe('true');
		// getElementById, because aria-controls is matched by id and not by
		// selector: the key it is built from carries the endpoint path.
		const panelId = disclosure.getAttribute('aria-controls');
		expect(panelId).toBeTruthy();
		expect(document.getElementById(panelId as string)).toBeTruthy();
	});

	it('copies without opening the row', async () => {
		// The copy button sits beside the disclosure rather than inside it, so
		// its click never reaches the row.
		const { container } = setup();
		const [disclosure] = disclosures(container);

		await fireEvent.click(screen.getByRole('button', { name: 'Copy the path /api/admin/media' }));

		expect(clip.copyText).toHaveBeenCalledWith('/api/admin/media');
		expect(disclosure.getAttribute('aria-expanded')).toBe('false');
	});

	it('names every copy control by what it copies', async () => {
		const { container } = setup();
		await fireEvent.click(disclosures(container)[0]);

		expect(
			screen.getByRole('button', {
				name: 'Copy the example response body for GET /api/admin/media',
			}),
		).toBeTruthy();
	});

	it('names the search box for a reader who cannot see the placeholder', () => {
		setup();

		expect(screen.getByLabelText('Search endpoints')).toBeTruthy();
	});
});

/*
 * Running an endpoint from the page that documents it.
 *
 * The reader already holds a session against the engine being documented, so
 * a GET needs nothing set up. A write is a different thing entirely: this page
 * looks like documentation rather than like a console, and a DELETE here
 * deletes real data.
 */
describe('try it', () => {
	const withMethod = (method: string, canSeeAdmin: boolean) =>
		render(ApiReferencePage, {
			props: {
				data: {
					groups: [
						{
							id: 'content',
							label: 'Content',
							description: '',
							server: 'api',
							endpoints: [
								{
									method,
									path: '/api/v1/content/post',
									summary: `${method} /api/v1/content/post`,
									auth: 'bearer',
								},
							],
						},
					],
					collections: 0,
					source: 'engine',
					canSeeAdmin,
				} as unknown as PageData,
				form: null,
			},
		});

	it('offers a read to anyone who can see the page', async () => {
		const { getByRole, container } = withMethod('GET', false);
		await fireEvent.click(getByRole('button', { name: /GET \/api\/v1\/content\/post/ }));
		expect(container.textContent).toContain('Try it');
		expect(container.textContent).toContain('Send');
	});

	it('marks a write as one before it is opened', async () => {
		const { getByRole, container } = withMethod('DELETE', true);
		await fireEvent.click(getByRole('button', { name: /DELETE \/api\/v1\/content\/post/ }));
		expect(container.textContent).toContain('changes data');
	});

	// The role is checked again on the server. This is the half that stops an
	// admin being offered a button that would only be refused.
	it('offers an admin no way to send a write, and says why', async () => {
		const { getByRole, container } = withMethod('DELETE', false);
		await fireEvent.click(getByRole('button', { name: /DELETE \/api\/v1\/content\/post/ }));
		expect(container.textContent).toContain("is a super admin's");
		expect(container.textContent).not.toContain('I mean to send this');
	});

	it('makes a super admin acknowledge the one call', async () => {
		const { getByRole, container } = withMethod('DELETE', true);
		await fireEvent.click(getByRole('button', { name: /DELETE \/api\/v1\/content\/post/ }));
		expect(container.textContent).toContain('I mean to send this DELETE');
	});

	// A path still carrying {id} asks the engine for a record whose id is the
	// literal text, which answers 404 and reads as the endpoint being broken.
	it('says which parameters are still placeholders', async () => {
		const { getByRole, container } = render(ApiReferencePage, {
			props: {
				data: {
					groups: [
						{
							id: 'content',
							label: 'Content',
							description: '',
							server: 'api',
							endpoints: [
								{
									method: 'GET',
									path: '/api/v1/content/{schema}/{id}',
									summary: 'GET one',
									auth: 'bearer',
								},
							],
						},
					],
					collections: 0,
					source: 'engine',
					canSeeAdmin: true,
				} as unknown as PageData,
				form: null,
			},
		});
		await fireEvent.click(getByRole('button', { name: /GET one/ }));
		expect(container.textContent).toContain('{schema}');
		expect(container.textContent).toContain('{id}');
	});
});
