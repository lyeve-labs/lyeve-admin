// @vitest-environment jsdom
import { render, cleanup, fireEvent, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));

import LabsPage from './+page.svelte';
import type { LabEndpoint, LabResult } from '$lib/api/labs';

afterEach(cleanup);

function said(c: HTMLElement): string {
	return (c.textContent ?? '').replace(/\s+/g, ' ');
}

function endpoint(over: Partial<LabEndpoint> = {}): LabEndpoint {
	return {
		id: 'GET /api/v1/content/{schema}',
		groupId: 'content',
		groupLabel: 'Content',
		server: 'api',
		method: 'GET',
		path: '/api/v1/content/{schema}',
		summary: 'List entries',
		params: [{ name: 'schema', in: 'path', type: 'string', required: true, description: '' }],
		...over,
	};
}

function result(over: Partial<LabResult> = {}): LabResult {
	return {
		method: 'GET',
		path: '/api/v1/content/articles',
		status: 200,
		statusText: 'OK',
		durationMs: 42,
		body: '{\n  "data": []\n}',
		json: true,
		headers: { 'content-type': 'application/json' },
		...over,
	};
}

const props = (over: Record<string, unknown> = {}, form: unknown = null) => ({
	data: {
		endpoints: [endpoint()],
		source: 'engine',
		grpc: { listening: true, routes: ['GET /api/schemas'], gate: { state: 'ok' } },
		...over,
	} as never,
	form: form as never,
});

describe('the warning a tester needs first', () => {
	// There is no sandbox. A page that did not say so would be read as one.
	it('says every request hits the live instance as the caller', () => {
		const { container } = render(LabsPage, { props: props() });
		const text = said(container);
		expect(text).toContain('instance you are signed in to, as you');
		expect(text).toContain('a write writes, and a delete deletes');
	});

	// The list is the allowlist. Rendering the fallback silently would offer
	// endpoints this build may not serve while implying the engine said so.
	it('says when the endpoint list is the fallback rather than the engine', () => {
		const { container } = render(LabsPage, { props: props({ source: 'catalog' }) });
		expect(said(container)).toContain('rather than what this build actually serves');
	});

	it('says nothing of the sort when the engine answered', () => {
		const { container } = render(LabsPage, { props: props() });
		expect(said(container)).not.toContain('rather than what this build actually serves');
	});
});

describe('the answer', () => {
	it('shows the status, the timing and the body', () => {
		const { container } = render(LabsPage, { props: props({}, { rest: result() }) });
		const text = said(container);
		expect(text).toContain('200 OK');
		expect(text).toContain('42 ms');
		expect(text).toContain('"data"');
	});

	// The status a tester meets and misreads as a broken request.
	it('explains a 402 as a disabled plugin rather than a bad request', () => {
		const { container } = render(LabsPage, {
			props: props({}, { rest: result({ status: 402, statusText: 'Payment Required' }) }),
		});
		expect(said(container)).toContain('Nothing about the request is wrong');
	});

	it('says a body is empty rather than rendering nothing', () => {
		const { container } = render(LabsPage, {
			props: props({}, { rest: result({ body: '', json: false, status: 204, statusText: 'No Content' }) }),
		});
		expect(said(container)).toContain('(empty body)');
	});
});

describe('GraphQL', () => {
	// GraphQL answers 200 and puts the failure in the body, so a status badge
	// alone reads as success.
	it('warns that a 200 carrying errors is not a success', () => {
		const { container } = render(LabsPage, {
			props: props({}, { graphql: result({ path: '/api/v1/graphql', body: '{"errors":[{"message":"boom"}]}' }) }),
		});
		expect(said(container)).toContain('read the body rather than the status');
	});

	it('says nothing of the sort on a clean response', () => {
		const { container } = render(LabsPage, {
			props: props({}, { graphql: result({ path: '/api/v1/graphql', body: '{"data":{}}' }) }),
		});
		expect(said(container)).not.toContain('read the body rather than the status');
	});
});

describe('gRPC', () => {
	// Those paths are on the plugin's own listener. The engine runs the call
	// inside the plugin rather than reaching across to it, so the tab sends.
	it('offers the transcoded routes and a way to run one', async () => {
		const { container } = render(LabsPage, { props: props() });
		await fireEvent.click(screen.getByRole('radio', { name: /grpc/i }));
		const text = said(container);
		expect(text).toContain('runs the call inside the plugin');
		expect(container.querySelector('form[action="?/grpc"]')).not.toBeNull();
	});

	it('will not run until a route is chosen', async () => {
		render(LabsPage, { props: props() });
		await fireEvent.click(screen.getByRole('radio', { name: /grpc/i }));
		expect(screen.getByRole('button', { name: /run/i })).toHaveProperty('disabled', true);
	});

	it('shows the transcoded handler status, not the engine call status', async () => {
		const { container } = render(LabsPage, {
			props: props(
				{},
				{
					grpc: result({ path: '/api/content/post', status: 404, body: '{"error":"schema not found"}' }),
					grpcRoute: 'GET /api/content/{schema}',
				},
			),
		});
		await fireEvent.click(screen.getByRole('radio', { name: /grpc/i }));
		const text = said(container);
		expect(text).toContain('404');
		expect(text).toContain('schema not found');
	});

	it('says the plugin is absent rather than showing an empty list', async () => {
		const { container } = render(LabsPage, {
			props: props({ grpc: { listening: false, routes: [], gate: { state: 'absent' } } }),
		});
		await fireEvent.click(screen.getByRole('radio', { name: /grpc/i }));
		expect(said(container)).toContain('no listener to call');
	});

	// The status route is a super admin's, and an admin is not told the
	// plugin is missing.
	it('tells a role below super admin that the role is why', async () => {
		const { container } = render(LabsPage, {
			props: props({ grpc: { listening: false, routes: [], gate: { state: 'forbidden' } } }),
		});
		await fireEvent.click(screen.getByRole('radio', { name: /grpc/i }));
		expect(said(container)).toContain('Your role cannot open the gRPC listener.');
		expect(said(container)).not.toContain('not part of this build');
	});

	it('offers a retry when the status could not be read', async () => {
		const { container } = render(LabsPage, {
			props: props({ grpc: { listening: false, routes: [], gate: { state: 'unavailable' } } }),
		});
		await fireEvent.click(screen.getByRole('radio', { name: /grpc/i }));
		expect(said(container)).toContain('the gRPC listener could not be read');
		expect(said(container)).not.toContain('not part of this build');
		expect(said(container)).toContain('Try again');
	});

	it('separates a missing plugin from one that is present and down', async () => {
		const { container } = render(LabsPage, {
			props: props({ grpc: { listening: false, routes: [], gate: { state: 'ok' } } }),
		});
		await fireEvent.click(screen.getByRole('radio', { name: /grpc/i }));
		expect(said(container)).toContain('present and nothing is listening');
	});
});

describe('the endpoint picker', () => {
	it('names its search box for a screen reader', () => {
		const { container } = render(LabsPage, { props: props() });
		const label = container.querySelector('label[for="endpoint-narrow"]');
		expect(label?.textContent).toBe('Search endpoints');
		expect(container.querySelector('#endpoint-narrow')).toBeTruthy();
	});

	// Squeezed by the summary on a phone, the path stacked one character per
	// line.
	it('keeps the path its width and drops the summary below the small breakpoint', () => {
		const { container } = render(LabsPage, { props: props() });
		const cells = container.querySelectorAll('table[aria-label="Pick an endpoint"] td, [aria-label="Pick an endpoint"] td');
		const path = [...cells].find((c) => c.classList.contains('font-mono')) as HTMLElement;
		expect(path.className).toContain('min-w-56');
		const summary = path.nextElementSibling as HTMLElement;
		expect(summary.className).toContain('hidden');
		expect(summary.className).toContain('sm:table-cell');
	});

	// The row is wider than its scroll box on a phone and a tablet, which left
	// the Select button past the box edge.
	it('keeps the Select cell stuck to the end of the scroll box, painted like its row', () => {
		const { getAllByRole } = render(LabsPage, { props: props() });
		const cell = getAllByRole('button', { name: 'Select' })[0].closest('td') as HTMLElement;
		for (const cls of ['sticky', 'end-0', 'z-1', 'bg-ink', '[tr:hover>&]:bg-[color-mix(in_srgb,var(--color-surface-2)_60%,var(--color-ink))]']) {
			expect(cell.className.split(/\s+/), cls).toContain(cls);
		}
		expect((cell.closest('tr') as HTMLElement).className).not.toContain('relative');
	});

	it('gives each row one Select button, and a click picks that row', async () => {
		const posts = endpoint({ id: 'POST /api/v1/content/{schema}', method: 'POST', summary: 'Create an entry' });
		const { container, getByRole, queryByRole } = render(LabsPage, { props: props({ endpoints: [endpoint(), posts] }) });
		const rows = [...container.querySelectorAll('[aria-label="Pick an endpoint"] tbody tr')] as HTMLElement[];
		expect(rows).toHaveLength(2);
		for (const row of rows) {
			const buttons = [...row.querySelectorAll('button')];
			expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Select']);
		}
		await fireEvent.click(rows[1].querySelector('button') as HTMLElement);
		expect(rows[1].querySelector('button')?.textContent?.trim()).toBe('Selected');
		expect(rows[0].querySelector('button')?.textContent?.trim()).toBe('Select');
		expect(getByRole('heading', { level: 2, name: 'POST /api/v1/content/{schema}' })).toBeTruthy();
		expect(queryByRole('heading', { level: 2, name: 'GET /api/v1/content/{schema}' })).toBeNull();
	});
});
