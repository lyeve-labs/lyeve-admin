import { describe, expect, it, vi } from 'vitest';
import { createClient } from '@lyeve-labs/client';
import { FORM_EVENT, destinationProblem, flowProblem, formWarning, listForms, readFlowTargets, type FlowTarget } from './builder-forms';

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

describe('readFlowTargets under load', () => {
	it('keeps the section when one trigger read fails, and marks only that flow unknown', async () => {
		const { client } = engine({
			'/api/admin/flows': {
				data: [
					{ id: 'f1', slug: 'contact', name: 'Contact', status: 'active', version: 1, trigger_type: 'trigger.event' },
					{ id: 'f2', slug: 'broken', name: 'Broken', status: 'active', version: 1, trigger_type: 'trigger.event' },
				],
				total: 2,
			},
			'/api/admin/flows/f1/versions/1': { definition: { trigger: formTrigger } },
		});
		const flows = await readFlowTargets(client);
		expect(flows.map((f) => [f.slug, f.formTrigger])).toEqual([
			['contact', true],
			['broken', null],
		]);
		// An unknown trigger is not reported as the wrong one.
		expect(flowProblem('broken', flows)).toBeNull();
	});

	it('reads at most eight triggers at a time', async () => {
		const rows = Array.from({ length: 30 }, (_, i) => ({
			id: `f${i}`,
			slug: `flow-${i}`,
			name: `Flow ${i}`,
			status: 'active',
			version: 1,
			trigger_type: 'trigger.event',
		}));
		let inFlight = 0;
		let most = 0;
		const fetch = vi.fn(async (url: string) => {
			if (String(url).startsWith('/api/admin/flows?')) return json({ data: rows, total: rows.length });
			inFlight++;
			most = Math.max(most, inFlight);
			await new Promise((r) => setTimeout(r, 2));
			inFlight--;
			return json({ definition: { trigger: formTrigger } });
		});
		const flows = await readFlowTargets(createClient(fetch as unknown as typeof globalThis.fetch));
		expect(flows.every((f) => f.formTrigger)).toBe(true);
		expect(fetch).toHaveBeenCalledTimes(31);
		expect(most).toBe(8);
	});
});

describe('destinationProblem', () => {
	const flows: FlowTarget[] = [{ id: '1', slug: 'notify', name: 'Notify', status: 'active', formTrigger: true }];
	const allowed = { form_schemas: ['contact_messages'], form_flows: ['notify'] };

	it('flags a content type or a flow that forms may no longer send to', () => {
		expect(destinationProblem({ schema: 'contact_messages' }, allowed, flows)).toBeNull();
		expect(destinationProblem({ schema: 'leads' }, allowed, flows)).toBe('schema-not-allowed');
		expect(destinationProblem({ flow: 'notify' }, allowed, flows)).toBeNull();
		expect(destinationProblem({ flow: 'notify' }, { ...allowed, form_flows: [] }, flows)).toBe('flow-not-allowed');
	});

	it('checks nothing it could not load, and nothing for a form with no destination', () => {
		expect(destinationProblem({ schema: 'leads' }, null, null)).toBeNull();
		expect(destinationProblem({ flow: 'gone' }, allowed, null)).toBe('flow-not-allowed');
		expect(destinationProblem({ flow: 'notify' }, allowed, null)).toBeNull();
		expect(destinationProblem(null, allowed, flows)).toBeNull();
	});
});

describe('flowProblem', () => {
	const flows: FlowTarget[] = [
		{ id: '1', slug: 'contact', name: 'Contact', status: 'active', formTrigger: true },
		{ id: '2', slug: 'paused', name: 'Paused', status: 'disabled', formTrigger: true },
		{ id: '3', slug: 'other', name: 'Other', status: 'active', formTrigger: false },
		{ id: '4', slug: 'stuck', name: 'Stuck', status: 'blocked', formTrigger: true },
	];

	it('names why a form sending to the slug starts nothing', () => {
		expect(flowProblem('contact', flows)).toBeNull();
		expect(flowProblem('paused', flows)).toBe('inactive');
		expect(flowProblem('other', flows)).toBe('trigger');
		expect(flowProblem('gone', flows)).toBe('missing');
		expect(flowProblem('stuck', flows)).toBe('blocked');
	});

	it('does not tell the reader to publish a blocked flow', () => {
		expect(formWarning('blocked', 'Stuck')).toBe('The flow Stuck uses a step that is no longer available, so posts to this form start nothing.');
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
