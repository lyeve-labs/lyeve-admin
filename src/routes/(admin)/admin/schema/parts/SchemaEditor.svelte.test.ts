// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Schema } from '@lyeve-labs/client';
import type { Problem } from '$lib/schema/editor';
import { DdlHistory } from './ddl-history.svelte';
import SchemaEditor from './SchemaEditor.svelte';

let teardown: (() => void) | undefined;
afterEach(() => {
	cleanup();
	teardown?.();
	teardown = undefined;
});

function posts(): Schema {
	return {
		name: 'posts',
		display_name: 'Posts',
		fields: [
			{ id: 'f-id', name: 'id', field_type: 'uid', required: true, unique: true, indexed: true, system: true },
			{ id: 'f-title', name: 'title', field_type: 'text', required: true, unique: false, indexed: false, localized: true },
		],
	};
}

/**
 * Renders the editor over a state object, the way the page binds it, so a
 * case reads every edit back from the schema it handed in.
 */
function setup(over: Record<string, unknown> = {}) {
	let ddl!: DdlHistory;
	// A case that sets up twice ends the first root before it builds the second.
	teardown?.();
	teardown = $effect.root(() => {
		ddl = new DdlHistory({ table: () => 'posts', isSuperAdmin: () => true, rowCounts: () => ({}) });
	});
	const onrename = vi.fn();
	const props = $state({
		schema: posts(),
		localizedCleared: {} as Record<string, string>,
		saved: posts() as Schema | null,
		schemas: [posts(), { name: 'authors', display_name: 'Authors', fields: [] }] as Schema[],
		canWrite: true,
		isNewSchema: false,
		dirty: false,
		saveError: '',
		problems: [] as Problem[],
		isSuperAdmin: false,
		ddl,
		onrename,
		...over,
	});
	render(SchemaEditor, { props });
	return { props, onrename };
}

describe('SchemaEditor', () => {
	it('adds a field and a typed relation to the schema it was handed', async () => {
		const { props } = setup();
		await fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Add relation' }));
		expect(props.schema.fields.map((f) => f.field_type)).toEqual(['uid', 'text', 'text', 'relation']);
		expect(props.schema.fields[3].relation_type).toBe('belongs_to');
	});

	it('removes a user field and offers no remove on a system one', async () => {
		const { props } = setup();
		expect(screen.queryByRole('button', { name: 'Remove field id' })).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Remove field title' }));
		expect(props.schema.fields.map((f) => f.name)).toEqual(['id']);
	});

	it('moves a saved table only through Rename, and holds Rename while there are edits', async () => {
		const { props, onrename } = setup();
		expect((screen.getByLabelText('Machine name') as HTMLInputElement).readOnly).toBe(true);
		await fireEvent.click(screen.getByRole('button', { name: /Rename/ }));
		expect(onrename).toHaveBeenCalledTimes(1);
		props.dirty = true;
		flushSync();
		expect((screen.getByRole('button', { name: /Rename/ }) as HTMLButtonElement).disabled).toBe(true);
	});

	it('takes the machine name of a new schema and shows its problem there', () => {
		setup({
			saved: null,
			isNewSchema: true,
			problems: [{ fieldId: null, target: 'schema-name', where: 'Machine name', message: 'Name the schema.' }],
		});
		const name = screen.getByLabelText('Machine name') as HTMLInputElement;
		expect(name.readOnly).toBe(false);
		expect(screen.getByText('Name the schema.')).toBeTruthy();
		expect(screen.queryByRole('button', { name: /Rename/ })).toBeNull();
	});

	it('announces a failed save in a live region that was already there', () => {
		const { props } = setup();
		const region = document.querySelector('[aria-live="assertive"]') as HTMLElement;
		expect(region.textContent?.trim()).toBe('');
		props.saveError = 'The schema could not be saved.';
		flushSync();
		expect(screen.getByTestId('save-error').textContent).toContain('The schema could not be saved.');
	});

	it('names each transport control by id and hint, and stores only what was narrowed', async () => {
		const { props } = setup();
		const group = document.getElementById('transport-rest') as HTMLElement;
		expect(group.getAttribute('role')).toBe('radiogroup');
		expect(document.getElementById(group.getAttribute('aria-describedby') ?? '')?.textContent).toBe('The content API.');
		await fireEvent.click(within(group).getByRole('radio', { name: 'Read only' }));
		expect(props.schema.transports).toEqual({ rest: 'r' });
		await fireEvent.click(within(group).getByRole('radio', { name: 'Read and write' }));
		expect(props.schema.transports).toBeUndefined();
	});

	it('ties a relation kind problem to its radio group', () => {
		const schema = posts();
		schema.fields.push({ id: 'f-rel', name: 'parent', field_type: 'relation', relation_type: 'belongs_to', relation_to: 'posts', required: false, unique: false, indexed: false });
		setup({
			schema,
			problems: [{ fieldId: 'f-rel', target: 'relation-type-f-rel', where: 'parent', message: 'The kind is wrong here.' }],
		});
		const group = document.getElementById('relation-type-f-rel') as HTMLElement;
		expect(group.getAttribute('role')).toBe('radiogroup');
		expect(document.getElementById(group.getAttribute('aria-describedby') ?? '')?.textContent).toBe('The kind is wrong here.');
	});

	it('records why a localized mark was cleared when the type can no longer carry it', async () => {
		const { props } = setup();
		await fireEvent.click(screen.getByRole('combobox', { name: 'Type, title' }));
		await fireEvent.click(screen.getByRole('option', { name: 'number' }));
		expect(props.schema.fields[1].localized).not.toBe(true);
		expect(props.localizedCleared['f-title']).toBeTruthy();
		expect(screen.getByText(/No longer translated per locale\./)).toBeTruthy();
	});

	it('locks every control for a role that cannot write', () => {
		setup({ canWrite: false });
		expect(screen.getByRole('group', { name: /Definition of Posts/ }).hasAttribute('disabled')).toBe(true);
		expect(screen.queryByRole('button', { name: 'Add field' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Remove field title' })).toBeNull();
		expect(screen.queryByRole('button', { name: /Rename/ })).toBeNull();
	});

	it('shows a saved table its API, and its history to a super admin only', () => {
		setup();
		expect(screen.getByRole('button', { name: /This collection's API/ })).toBeTruthy();
		expect(screen.queryByRole('button', { name: /History/ })).toBeNull();
		cleanup();
		setup({ isSuperAdmin: true });
		expect(screen.getByRole('button', { name: /History/ })).toBeTruthy();
	});
});
