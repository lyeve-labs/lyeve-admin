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
		grpc: { listening: true, routes: ['GET /api/schemas'], reachable: true },
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
			props: props({ grpc: { listening: false, routes: [], reachable: false } }),
		});
		await fireEvent.click(screen.getByRole('radio', { name: /grpc/i }));
		expect(said(container)).toContain('no listener to call');
	});

	it('separates a missing plugin from one that is present and down', async () => {
		const { container } = render(LabsPage, {
			props: props({ grpc: { listening: false, routes: [], reachable: true } }),
		});
		await fireEvent.click(screen.getByRole('radio', { name: /grpc/i }));
		expect(said(container)).toContain('present and nothing is listening');
	});
});
