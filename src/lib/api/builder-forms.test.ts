import { describe, expect, it, vi } from 'vitest';
import { createClient } from '@lyeve-labs/client';
import { FORM_EVENT, flowProblem, formWarning, listForms, readFlowTargets, type FlowTarget } from './builder-forms';

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function engine(routes: Record<string, unknown>) {
	const paths: string[] = [];
	const fetch = vi.fn(async (url: string) => {
		const path = String(url);
		paths.push(path);
		const hit = routes[path.split('?')[0]];
		return hit === undefined ? json({ error: 'not found' }, 404) : json(hit);
	});
	return { client: createClient(fetch as unknown as typeof globalThis.fetch), paths };
}

const formTrigger = { type: 'trigger.event', config: { kind: 'system', name: FORM_EVENT } };

describe('readFlowTargets', () => {
	it('reads the trigger of each event flow from its published version, or its draft before one', async () => {
		const { client, paths } = engine({
			'/api/admin/flows': {
				data: [
					{ id: 'f1', slug: 'contact', name: 'Contact', status: 'active', version: 2, trigger_type: 'trigger.event' },
					{ id: 'f2', slug: 'draft-one', name: 'Draft', status: 'draft', version: 0, trigger_type: 'trigger.event' },
					{ id: 'f3', slug: 'on-save', name: 'On save', status: 'active', version: 1, trigger_type: 'trigger.event' },
					{ id: 'f4', slug: 'hook', name: 'Hook', status: 'active', version: 1, trigger_type: 'trigger.http' },
				],
				total: 4,
			},
			'/api/admin/flows/f1/versions/2': { definition: { trigger: formTrigger } },
			'/api/admin/flows/f2': { id: 'f2', draft: { trigger: formTrigger } },
			'/api/admin/flows/f3/versions/1': { definition: { trigger: { type: 'trigger.event', config: { kind: 'content', schema: 'posts' } } } },
		});
		const flows = await readFlowTargets(client);
		expect(flows.map((f) => [f.slug, f.formTrigger, f.status])).toEqual([
			['contact', true, 'active'],
			['draft-one', true, 'draft'],
			['on-save', false, 'active'],
			['hook', false, 'active'],
		]);
		// A flow on another trigger type is never read again.
		expect(paths.some((p) => p.startsWith('/api/admin/flows/f4'))).toBe(false);
	});
});

describe('flowProblem', () => {
	const flows: FlowTarget[] = [
		{ id: '1', slug: 'contact', name: 'Contact', status: 'active', formTrigger: true },
		{ id: '2', slug: 'paused', name: 'Paused', status: 'disabled', formTrigger: true },
		{ id: '3', slug: 'other', name: 'Other', status: 'active', formTrigger: false },
	];

	it('names why a form sending to the slug starts nothing', () => {
		expect(flowProblem('contact', flows)).toBeNull();
		expect(flowProblem('paused', flows)).toBe('inactive');
		expect(flowProblem('other', flows)).toBe('trigger');
		expect(flowProblem('gone', flows)).toBe('missing');
	});

	it('words the warning with the flow name', () => {
		expect(formWarning('inactive', 'Paused')).toBe(
			'The flow Paused is not active, so posts to this form start nothing. Publish the flow to turn it on.',
		);
	});
});

describe('listForms', () => {
	it('fills what an older answer leaves out', async () => {
		const { client } = engine({
			'/api/admin/builder/forms': { data: [{ site: 's1', path: '/', block: 'b1', label: '', destination: null, counts: { new: 2 } }] },
		});
		expect(await listForms(client)).toEqual([
			{ site: 's1', site_name: '', path: '/', block: 'b1', label: '', destination: null, counts: { new: 2, read: 0, spam: 0 } },
		]);
	});
});
