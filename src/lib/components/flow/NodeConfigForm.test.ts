// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NodeConfigForm from './NodeConfigForm.svelte';
import { fixtureCatalog, fixtureEventTypes, fixtureFlowOptions, fixtureGroupedEventTypes } from '$lib/flow/fixtures';

afterEach(cleanup);

const query = fixtureCatalog.find((s) => s.type === 'content.query')!;
const join = fixtureCatalog.find((s) => s.type === 'data.join')!;
const respond = fixtureCatalog.find((s) => s.type === 'response')!;
const call = fixtureCatalog.find((s) => s.type === 'flow.call')!;
const event = fixtureCatalog.find((s) => s.type === 'trigger.event')!;

describe('NodeConfigForm', () => {
	it('renders one control per property, chosen by the schema', () => {
		const { container, getByLabelText } = render(NodeConfigForm, {
			props: { schema: query.config_schema, value: { schema: 'orders', limit: 100 }, onchange: vi.fn() },
		});
		expect((getByLabelText(/^Schema/) as HTMLInputElement).value).toBe('orders');
		expect((getByLabelText('limit') as HTMLInputElement).value).toBe('100');
		// A picker with nothing loaded is a plain field that says why.
		const sort = getByLabelText('sort') as HTMLInputElement;
		expect(sort.tagName).toBe('INPUT');
		expect(container.textContent).toContain('The schema is not in the list');
		// A free map renders as a key and value editor.
		expect(getByLabelText('New key')).toBeTruthy();
	});

	it('writes a string back into the config', async () => {
		const onchange = vi.fn();
		const { getByLabelText } = render(NodeConfigForm, {
			props: { schema: query.config_schema, value: { schema: 'orders' }, onchange },
		});
		await fireEvent.input(getByLabelText(/^Schema/), { target: { value: 'customers' } });
		expect(onchange).toHaveBeenLastCalledWith({ schema: 'customers' });
	});

	it('drops a key whose field was cleared', async () => {
		const onchange = vi.fn();
		const { getByLabelText } = render(NodeConfigForm, {
			props: { schema: query.config_schema, value: { schema: 'orders', sort: '-x' }, onchange },
		});
		await fireEvent.input(getByLabelText('sort'), { target: { value: '' } });
		expect(onchange).toHaveBeenLastCalledWith({ schema: 'orders' });
	});

	it('adds and removes tags on an array of strings', async () => {
		const onchange = vi.fn();
		const { getByLabelText, getByRole } = render(NodeConfigForm, {
			props: { schema: query.config_schema, value: { schema: 'orders', populate: ['customer'] }, onchange },
		});
		const input = getByLabelText('populate') as HTMLInputElement;
		input.value = 'items';
		await fireEvent.keyDown(input, { key: 'Enter' });
		expect(onchange).toHaveBeenLastCalledWith({ schema: 'orders', populate: ['customer', 'items'] });

		// Removing the last tag drops the key rather than sending an empty list.
		await fireEvent.click(getByRole('button', { name: /remove customer/i }));
		expect(onchange).toHaveBeenLastCalledWith({ schema: 'orders' });
	});

	it('renders an enum as a listbox and a boolean as a toggle', async () => {
		const onchange = vi.fn();
		const { getByRole, getByLabelText } = render(NodeConfigForm, {
			props: { schema: join.config_schema, value: { how: 'left', many: true }, onchange },
		});
		expect(getByRole('combobox', { name: /how/i })).toBeTruthy();
		const many = getByLabelText('many') as HTMLElement;
		await fireEvent.click(many);
		expect(onchange).toHaveBeenLastCalledWith({ how: 'left', many: false });
	});

	it('edits a free map as key and value rows under a real heading', async () => {
		const onchange = vi.fn();
		const { getByLabelText, getByRole } = render(NodeConfigForm, {
			props: { schema: respond.config_schema, value: { headers: { 'x-a': '1' } }, onchange },
		});
		expect(getByRole('heading', { level: 3, name: 'headers' })).toBeTruthy();
		const draft = getByLabelText('New key') as HTMLInputElement;
		await fireEvent.input(draft, { target: { value: 'x-b' } });
		await fireEvent.keyDown(draft, { key: 'Enter' });
		expect(onchange).toHaveBeenLastCalledWith({ headers: { 'x-a': '1', 'x-b': '' } });
	});

	it('shows an error on a path below a field under that field, with the rest of the path', () => {
		const { container } = render(NodeConfigForm, {
			props: {
				schema: respond.config_schema,
				value: { headers: { 'x-a': '1' } },
				errors: [{ node_id: 'respond', path: '/config/headers/x-a', message: 'must be a string' }],
				onchange: vi.fn(),
			},
		});
		expect(container.textContent).toContain('x-a: must be a string');
	});

	it('shows the validation error beside the field it names', () => {
		const { container } = render(NodeConfigForm, {
			props: {
				schema: join.config_schema,
				value: {},
				errors: [{ node_id: 'join', path: '/config/left_key', message: 'required' }],
				onchange: vi.fn(),
			},
		});
		expect(container.textContent).toContain('required');
	});
});

import { fixtureDatasources, fixtureIntrospection, fixtureSchemas } from '$lib/flow/fixtures';

const sql = fixtureCatalog.find((s) => s.type === 'db.query')!;

/** The kit's listbox: click the trigger, then the option by its text. */
async function pick(container: HTMLElement, id: string, optionText: string) {
	const trigger = container.querySelector(`[id="${id}"]`) as HTMLElement;
	await fireEvent.click(trigger);
	const option = [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent?.includes(optionText)) as HTMLElement;
	await fireEvent.click(option);
}

describe('NodeConfigForm pickers', () => {
	it('offers the content schemas for a schema key and writes the picked name', async () => {
		const onchange = vi.fn();
		const { container, getByRole } = render(NodeConfigForm, {
			props: { schema: query.config_schema, value: { schema: 'orders' }, schemas: fixtureSchemas, onchange },
		});
		expect(getByRole('combobox', { name: /schema/i })).toBeTruthy();
		await pick(container, 'cfg-schema', 'Shipments');
		expect(onchange).toHaveBeenLastCalledWith({ schema: 'shipments' });
	});

	it('keeps an expression as free text when it is not a schema the list knows', async () => {
		const onchange = vi.fn();
		const { container, getByLabelText } = render(NodeConfigForm, {
			props: { schema: query.config_schema, value: { schema: '{{ trigger.query.schema }}' }, schemas: fixtureSchemas, onchange },
		});
		const custom = getByLabelText('Schema value') as HTMLInputElement;
		expect(custom.value).toBe('{{ trigger.query.schema }}');
		await fireEvent.input(custom, { target: { value: '{{ vars.schema }}' } });
		expect(onchange).toHaveBeenLastCalledWith({ schema: '{{ vars.schema }}' });
		// The escape row is there for a value the list does know, too.
		await pick(container, 'cfg-schema', 'Custom value');
		expect(getByLabelText('Schema value')).toBeTruthy();
	});

	it('offers the fields of the sibling schema, with the system columns and both sort directions', async () => {
		const onchange = vi.fn();
		const { container } = render(NodeConfigForm, {
			props: { schema: query.config_schema, value: { schema: 'orders' }, schemas: fixtureSchemas, onchange },
		});
		await fireEvent.click(container.querySelector('#cfg-sort') as HTMLElement);
		const labels = [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent?.trim());
		expect(labels).toContain('created_at descending');
		expect(labels).toContain('total ascending');
		await fireEvent.click([...document.querySelectorAll('[role="option"]')].find((o) => o.textContent?.includes('created_at descending')) as HTMLElement);
		expect(onchange).toHaveBeenLastCalledWith({ schema: 'orders', sort: '-created_at' });
	});

	it('adds fields to a list from a picker and still takes a typed one', async () => {
		const onchange = vi.fn();
		const { container, getByLabelText } = render(NodeConfigForm, {
			props: { schema: query.config_schema, value: { schema: 'orders', populate: ['customer'] }, schemas: fixtureSchemas, onchange },
		});
		await pick(container, 'cfg-populate', 'status');
		expect(onchange).toHaveBeenLastCalledWith({ schema: 'orders', populate: ['customer', 'status'] });
		const custom = getByLabelText('populate custom value') as HTMLInputElement;
		custom.value = 'items.product';
		await fireEvent.keyDown(custom, { key: 'Enter' });
		expect(onchange).toHaveBeenLastCalledWith({ schema: 'orders', populate: ['customer', 'items.product'] });
	});

	it('makes the new key of a filters map a field picker', async () => {
		const onchange = vi.fn();
		const { container, getByRole } = render(NodeConfigForm, {
			props: { schema: query.config_schema, value: { schema: 'orders' }, schemas: fixtureSchemas, onchange },
		});
		expect(getByRole('combobox', { name: /new key/i })).toBeTruthy();
		await pick(container, 'cfg-filters-new', 'status');
		await fireEvent.click(getByRole('button', { name: /^add$/i }));
		expect(onchange).toHaveBeenLastCalledWith({ schema: 'orders', filters: { status: '' } });
	});

	it('offers only the datasources of the kinds the schema names', async () => {
		const onchange = vi.fn();
		const { container } = render(NodeConfigForm, {
			props: { schema: sql.config_schema, value: {}, datasources: fixtureDatasources, onchange },
		});
		await fireEvent.click(container.querySelector('#cfg-datasource') as HTMLElement);
		const labels = [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent?.trim());
		expect(labels).toContain('warehouse (postgres)');
		expect(labels.some((l) => l?.startsWith('inventory'))).toBe(false);
	});

	it('renders a SQL field as the code editor and asks for the datasource tables once', async () => {
		const onintrospect = vi.fn();
		const { getByTestId, rerender } = render(NodeConfigForm, {
			props: {
				schema: sql.config_schema,
				value: { datasource: 'warehouse', sql: 'select 1' },
				datasources: fixtureDatasources,
				tables: {},
				onintrospect,
				onchange: vi.fn(),
			},
		});
		expect(getByTestId('code-editor').getAttribute('data-language')).toBe('sql');
		expect(onintrospect).toHaveBeenCalledWith('d1');
		expect(onintrospect).toHaveBeenCalledTimes(1);
		await rerender({
			schema: sql.config_schema,
			value: { datasource: 'warehouse', sql: 'select 1' },
			datasources: fixtureDatasources,
			tables: { d1: { status: 'ready', tables: fixtureIntrospection.tables } },
			onintrospect,
			onchange: vi.fn(),
		});
		expect(onintrospect).toHaveBeenCalledTimes(1);
		expect(getByTestId('tables-panel').textContent).toContain('public.orders');
	});
});

describe('NodeConfigForm flow and event pickers', () => {
	it('offers the published flows for a flow key, without the flow on the canvas', async () => {
		const onchange = vi.fn();
		const { container, getByRole } = render(NodeConfigForm, {
			props: { schema: call.config_schema, value: {}, flows: fixtureFlowOptions, selfId: 'f1', onchange },
		});
		expect(getByRole('combobox', { name: /flow/i })).toBeTruthy();
		await fireEvent.click(container.querySelector('#cfg-flow') as HTMLElement);
		const labels = [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent?.trim());
		expect(labels).toEqual(['Send receipt (send-receipt)', 'nightly-sync', 'Another slug or an expression']);
		await fireEvent.click([...document.querySelectorAll('[role="option"]')].find((o) => o.textContent?.includes('Send receipt')) as HTMLElement);
		expect(onchange).toHaveBeenLastCalledWith({ flow: 'send-receipt' });
	});

	it('falls back to a slug field that says why when no flow is published', () => {
		const { getByLabelText, container } = render(NodeConfigForm, {
			props: { schema: call.config_schema, value: { flow: 'send-receipt' }, flows: [], onchange: vi.fn() },
		});
		const flow = getByLabelText(/^Flow/) as HTMLInputElement;
		expect(flow.tagName).toBe('INPUT');
		expect(flow.value).toBe('send-receipt');
		expect(container.textContent).toContain('No other flow is published yet');
	});

	it('groups the hooks by plugin, shows the chosen one\'s description and writes the name', async () => {
		const onchange = vi.fn();
		const { container, rerender } = render(NodeConfigForm, {
			props: { schema: event.config_schema, value: { kind: 'system' }, events: fixtureGroupedEventTypes, onchange },
		});
		await fireEvent.click(container.querySelector('#cfg-name') as HTMLElement);
		const groups = [...document.querySelectorAll('[role="group"]')].map((g) => g.getAttribute('aria-label'));
		expect(groups).toEqual(['example', 'flow']);
		await fireEvent.click([...document.querySelectorAll('[role="option"]')].find((o) => o.textContent?.includes('flow.run_failed')) as HTMLElement);
		expect(onchange).toHaveBeenLastCalledWith({ kind: 'system', name: 'flow.run_failed' });
		await rerender({ schema: event.config_schema, value: { kind: 'system', name: 'flow.run_failed' }, events: fixtureGroupedEventTypes, onchange });
		expect(container.textContent).toContain('A flow run ended failed.');
	});

	it('keeps a hook the list does not know as free text and refuses a malformed one', async () => {
		const onchange = vi.fn();
		const { container, getByLabelText, rerender } = render(NodeConfigForm, {
			props: { schema: event.config_schema, value: { kind: 'system', name: 'example:after_close' }, events: fixtureEventTypes.system, onchange },
		});
		const custom = getByLabelText('Hook value') as HTMLInputElement;
		expect(custom.value).toBe('example:after_close');
		expect(custom.placeholder).toBe('plugin:after_something');
		expect(container.textContent).not.toContain('lowercase');
		await rerender({ schema: event.config_schema, value: { kind: 'system', name: 'Example' }, events: fixtureEventTypes.system, onchange });
		expect(container.textContent).toContain('lowercase');
	});

	it('takes a typed hook name when the engine listed none', async () => {
		const onchange = vi.fn();
		const { container, getByLabelText } = render(NodeConfigForm, {
			props: { schema: event.config_schema, value: { kind: 'system' }, events: [], onchange },
		});
		expect(container.textContent).toContain('The engine listed no hooks');
		await fireEvent.input(getByLabelText(/^Hook/), { target: { value: 'flow.run_failed' } });
		expect(onchange).toHaveBeenLastCalledWith({ kind: 'system', name: 'flow.run_failed' });
	});
});

describe('NodeConfigForm locked options and choice lists', () => {
	const trigger = {
		type: 'object',
		properties: {
			auth: { type: 'string', enum: ['public', 'auth', 'admin'] },
			path: { type: 'string', description: 'A path of your own.', 'x-enabled': false },
			protocols: {
				type: 'array',
				description: 'Which protocols may start the flow.',
				uniqueItems: true,
				default: ['rest'],
				items: { type: 'string', enum: ['rest', 'graphql', 'grpc', 'realtime'] },
			},
		},
	};

	it('renders a list of enum values as a multi-select holding the chosen ones', () => {
		const { container, getByTestId } = render(NodeConfigForm, {
			props: { schema: trigger, value: { protocols: ['rest', 'grpc'] }, idPrefix: 'trigger', onchange: vi.fn() },
		});
		const field = container.querySelector('#trigger-protocols');
		expect(field).not.toBeNull();
		expect(getByTestId('node-config-form').textContent).toContain('grpc');
	});

	it('shows the engine default as chosen when the key is absent', () => {
		const { getByTestId } = render(NodeConfigForm, {
			props: { schema: trigger, value: {}, idPrefix: 'trigger', onchange: vi.fn() },
		});
		expect(getByTestId('node-config-form').textContent).toContain('rest');
	});

	it('marks an option the plugin locks, and no other', () => {
		const { getByTestId, queryByTestId } = render(NodeConfigForm, {
			props: { schema: trigger, value: {}, onchange: vi.fn() },
		});
		expect(getByTestId('option-locked-path').textContent).toContain('path: only the default is enabled on this instance.');
		expect(queryByTestId('option-locked-protocols')).toBeNull();
		expect(queryByTestId('option-locked-auth')).toBeNull();
	});
});
