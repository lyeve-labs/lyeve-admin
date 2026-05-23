// @vitest-environment jsdom
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Entitlements } from '$lib/entitlements';

/** The shape `use:enhance` hands its submit function's callback. */
type EnhanceResult = { type: 'success' | 'failure' | 'error' | 'redirect' };
type EnhanceCallback = (opts: {
	result: EnhanceResult;
	update: (options?: { reset?: boolean }) => Promise<void>;
}) => Promise<void> | void;
type SubmitFn = (input: unknown) => EnhanceCallback | void;

// The real enhance is not exercised here, but the submit function each form
// passes it is: it decides whether the modal closes and whether load reruns.
const forms = vi.hoisted(() => ({ submits: [] as SubmitFn[] }));

vi.mock('$app/forms', () => ({
	enhance: (_node: HTMLFormElement, submit?: SubmitFn) => {
		if (submit) forms.submits.push(submit);
		return { destroy() {} };
	},
}));

// Removal asks through the kit's confirm dialog, which renders through a
// container the layout mounts and this test does not. The call is captured:
// what it said, and whether the page posted once it was agreed to.
const kit = vi.hoisted(() => ({ confirm: vi.fn(async () => false) }));
vi.mock('@lyeve-labs/ui-kit', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	confirm: kit.confirm,
}));

import PermissionsPage from './+page.svelte';

beforeEach(() => {
	kit.confirm.mockReset();
	kit.confirm.mockResolvedValue(false);
});

afterEach(() => {
	cleanup();
	forms.submits.length = 0;
});

const entitlements: Entitlements = {
	plan: 'example',
	state: 'active',
	features: ['rbac'],
	tenant_quota: 1,
};

const permission = {
	id: 'a1b2c3d4-0000-0000-0000-000000000000',
	role: 'editor',
	schema_name: 'article',
	actions: ['read'],
	field_mask: [],
	created_at: '2026-01-01T00:00:00Z',
};

function setup() {
	return render(PermissionsPage, {
		props: {
			data: {
				permissions: [permission],
				schemas: [{ name: 'article' }],
				entitlements,
				loadError: null,
			},
			form: null,
		} as never,
	});
}

function setupFailedLoad() {
	return render(PermissionsPage, {
		props: {
			data: {
				permissions: [],
				schemas: [],
				entitlements,
				loadError: 'Permission rules could not be read from the engine.',
			},
			form: null,
		} as never,
	});
}

/** Run the submit function the form under test handed to enhance. */
async function runEnhance(result: EnhanceResult) {
	const submit = forms.submits.at(-1);
	expect(submit, 'the form registered no submit function with enhance').toBeTruthy();
	const update = vi.fn(async () => {});
	const callback = await submit!({});
	expect(typeof callback, 'enhance was given no result callback').toBe('function');
	await (callback as EnhanceCallback)({ result, update });
	await tick();
	return update;
}

describe('permissions page', () => {
	it('posts the id the delete action reads, and only once agreed to', async () => {
		// The action deletes by id. A form that posts role and schema_name only
		// sends a null `id`, and removing a rule silently never succeeds.
		const { container, getAllByRole } = setup();
		const form = container.querySelector('form[action="?/delete"]') as HTMLFormElement;
		const submit = vi.spyOn(form, 'requestSubmit').mockImplementation(() => {});
		const remove = getAllByRole('button').find((b) =>
			b.getAttribute('aria-label')?.startsWith('Remove rule'),
		);
		expect(remove, 'no remove control on the row').toBeTruthy();

		await fireEvent.click(remove!);
		await tick();
		expect(submit, 'posted before the dialog answered').not.toHaveBeenCalled();

		kit.confirm.mockResolvedValue(true);
		await fireEvent.click(remove!);
		await tick();
		await tick();
		expect(new FormData(form).get('id')).toBe(permission.id);
		expect(submit).toHaveBeenCalled();
	});

	it('names the rule it is about to remove', async () => {
		const { getAllByRole } = setup();
		const remove = getAllByRole('button').find((b) =>
			b.getAttribute('aria-label')?.startsWith('Remove rule'),
		);
		await fireEvent.click(remove!);
		await tick();
		// A destructive confirmation has to say which object it means.
		const [title, message, options] = kit.confirm.mock.calls[0] as unknown as [string, string, { confirmLabel: string }];
		expect(title).toBe('Remove permission');
		expect(message).toContain('editor');
		expect(message).toContain('article');
		expect(options.confirmLabel).toBe('Delete');
	});
});

describe('permissions page load failure', () => {
	it('reports the failed read instead of drawing an empty matrix', () => {
		// A matrix with no rules is what an instance that restricts nothing
		// looks like. The operator's next act on this screen is granting access,
		// so an unreachable engine or an expired session must not share that
		// picture.
		const { container } = setupFailedLoad();
		expect(container.textContent).toContain('Permission rules could not be read from the engine.');
		expect(container.querySelector('table'), 'a matrix was drawn from a failed read').toBeNull();
	});

	it('offers no write control while the rules are unknown', () => {
		const { queryAllByRole } = setupFailedLoad();
		const add = queryAllByRole('button').find((b) => b.textContent?.includes('New role'));
		expect(add, 'add role stayed live on a failed read').toBeFalsy();
	});

	it('draws the matrix when the read succeeded', () => {
		const { container } = setup();
		expect(container.querySelector('table')).toBeTruthy();
	});
});

describe('permissions page enhance handling', () => {
	it('keeps the edit modal open when the save fails', async () => {
		const { container, getAllByRole } = setup();
		const edit = getAllByRole('button').find((b) => b.getAttribute('aria-label')?.startsWith('Edit rule'));
		await fireEvent.click(edit!);
		expect(container.querySelector('form[action="?/upsert"]')).toBeTruthy();

		const update = await runEnhance({ type: 'failure' });

		// Closing on a failure hides the only place the error can be read.
		expect(container.querySelector('form[action="?/upsert"]'), 'modal closed over a failed save').toBeTruthy();
		expect(update).toHaveBeenCalledWith({ reset: false });
	});

	it('closes the edit modal and reruns load on success', async () => {
		// A callback that replaces SvelteKit's handling entirely, with no
		// update() and no applyAction(), leaves the stale rule in the table.
		const { container, getAllByRole } = setup();
		const edit = getAllByRole('button').find((b) => b.getAttribute('aria-label')?.startsWith('Edit rule'));
		await fireEvent.click(edit!);

		const update = await runEnhance({ type: 'success' });

		expect(container.querySelector('form[action="?/upsert"]')).toBeNull();
		expect(update).toHaveBeenCalledWith({ reset: false });
	});

});

describe('permissions page role ceiling', () => {
	function setupAtCeiling(roleCap: number) {
		return render(PermissionsPage, {
			props: {
				data: { permissions: [permission], schemas: [{ name: 'article' }], entitlements, loadError: null, roleCap },
				form: null,
			} as never,
		});
	}

	it('states the ceiling the engine serves and offers no new role at it', () => {
		const { queryAllByRole, container } = setupAtCeiling(1);
		expect(container.textContent).toContain('1 of 1 roles');
		expect(container.textContent).toContain(
			"The engine refuses a new role past this instance's ceiling of 1. Every role you have keeps working.",
		);
		expect(queryAllByRole('button').find((b) => b.textContent?.includes('New role'))).toBeFalsy();
	});

	it('counts the roles the plugin reports rather than the rules on screen', () => {
		const { container } = render(PermissionsPage, {
			props: {
				data: { permissions: [permission], schemas: [{ name: 'article' }], entitlements, loadError: null, roleCap: 7, roleCount: 7 },
				form: null,
			} as never,
		});
		expect(container.textContent).toContain('7 of 7 roles');
	});

	it('says nothing of a ceiling below it', () => {
		const { container, getAllByRole } = setupAtCeiling(5);
		expect(container.textContent).not.toContain('of 5 roles');
		expect(getAllByRole('button').find((b) => b.textContent?.includes('New role'))).toBeTruthy();
	});
});

describe('permissions page new role', () => {
	it('opens a form that writes the new role wildcard rule', async () => {
		// A role held in component state would vanish on the next load. A role
		// is visible on this screen only where a rule names it, so the control
		// writes one.
		const { container, getAllByRole } = setup();
		const add = getAllByRole('button').find((b) => b.textContent?.includes('New role'));
		expect(add, 'no add role control').toBeTruthy();
		await fireEvent.click(add!);

		const form = container.querySelector('form[action="?/upsert"]') as HTMLFormElement;
		expect(form, 'add role did nothing').toBeTruthy();

		const input = container.querySelector('#new-role') as HTMLInputElement;
		expect(input.name).toBe('role');
		await fireEvent.input(input, { target: { value: 'reviewer' } });

		const posted = new FormData(form);
		expect(posted.get('role')).toBe('reviewer');
		expect(posted.get('schema_name')).toBe('*');
		// A new role grants nothing until a cell is edited.
		expect(posted.getAll('actions')).toEqual([]);
	});

	it('adds no role to the matrix until the write comes back', async () => {
		const { container, getAllByRole } = setup();
		const add = getAllByRole('button').find((b) => b.textContent?.includes('New role'));
		await fireEvent.click(add!);

		const input = container.querySelector('#new-role') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: 'reviewer' } });
		await tick();

		const table = container.querySelector('table') as HTMLTableElement;
		expect(table.textContent, 'a phantom role appeared before any rule existed').not.toContain('reviewer');
	});

	it('keeps the new role drawer open when the write fails', async () => {
		const { container, getAllByRole } = setup();
		const add = getAllByRole('button').find((b) => b.textContent?.includes('New role'));
		await fireEvent.click(add!);

		const update = await runEnhance({ type: 'failure' });

		expect(container.querySelector('#new-role'), 'modal closed over a refused role').toBeTruthy();
		expect(update).toHaveBeenCalledWith({ reset: false });
	});

	it('closes the new role drawer on success', async () => {
		const { container, getAllByRole } = setup();
		const add = getAllByRole('button').find((b) => b.textContent?.includes('New role'));
		await fireEvent.click(add!);

		const update = await runEnhance({ type: 'success' });

		expect(container.querySelector('#new-role')).toBeNull();
		expect(update).toHaveBeenCalledWith({ reset: false });
	});
});

interface Rule {
	id: string;
	role: string;
	schema_name: string;
	actions: string[];
	field_mask: string[];
	created_at: string;
}

let nextId = 0;
function rule(role: string, schema_name: string, actions: string[], field_mask: string[] = []): Rule {
	nextId++;
	return {
		id: `00000000-0000-0000-0000-${String(nextId).padStart(12, '0')}`,
		role,
		schema_name,
		actions,
		field_mask,
		created_at: '2026-01-01T00:00:00Z',
	};
}

function setupWith(permissions: Rule[], schemas: string[]) {
	return render(PermissionsPage, {
		props: {
			data: {
				permissions,
				schemas: schemas.map((name) => ({ name })),
				entitlements,
				loadError: null,
			},
			form: null,
		} as never,
	});
}

/** The role's own row, found through the disclosure that controls its rules. */
function roleRow(container: HTMLElement, role: string): HTMLElement {
	const button = container.querySelector(`button[aria-controls="rules-${role}"]`);
	expect(button, `no disclosure for ${role}`).toBeTruthy();
	return button!.closest('tr') as HTMLElement;
}

function childRow(container: HTMLElement, role: string, schema: string): HTMLElement {
	const rows = [...container.querySelectorAll(`#rules-${role} tr`)];
	const row = rows.find((r) => r.querySelector('td')?.textContent?.includes(schema));
	expect(row, `no row for ${schema} under ${role}`).toBeTruthy();
	return row as HTMLElement;
}

describe('permissions page role disclosure', () => {
	it('opens and closes a role from its own control', async () => {
		const { container } = setupWith([rule('editor', 'article', ['read'])], ['article']);
		const button = container.querySelector(
			'button[aria-controls="rules-editor"]',
		) as HTMLButtonElement;

		// A role holding a rule starts open, since its rules are the page.
		expect(button.getAttribute('aria-expanded')).toBe('true');
		expect(container.querySelectorAll('#rules-editor tr').length).toBeGreaterThan(0);

		await fireEvent.click(button);
		expect(button.getAttribute('aria-expanded')).toBe('false');
		expect(container.querySelectorAll('#rules-editor tr').length).toBe(0);
	});

	it('renders no row for a role that holds no rule', () => {
		// One row per role and schema would bury a dozen rules among hundreds
		// of empty rows, so only a rule draws a row.
		const { container } = setupWith([rule('editor', 'article', ['read'])], ['article', 'page']);
		expect(container.querySelectorAll('#rules-admin tr').length).toBe(0);
		expect(container.querySelectorAll('#rules-editor tr').length).toBe(2);
	});

	it('pins the wildcard rule first inside a role', () => {
		const { container } = setupWith(
			[rule('editor', 'article', ['read']), rule('editor', '*', ['read'])],
			['article'],
		);
		const first = container.querySelector('#rules-editor tr') as HTMLElement;
		expect(first.textContent).toContain('Every schema');
	});
});

describe('permissions page collapsed summary', () => {
	it('rolls an empty set up to none, never to all', () => {
		// every() is true over an empty array, so the obvious fold reports a
		// fully granted column over zero schemas, and the operator reads a
		// blanket grant off a screen that shows nothing.
		const { container } = setupWith([], []);
		expect(roleRow(container, 'admin').textContent).toContain('admin grants read on no schema.');
		expect(roleRow(container, 'admin').textContent).not.toContain('on every schema');
	});

	it('reports a role with no rule as granting nothing', () => {
		const { container } = setupWith([], ['article', 'page']);
		expect(roleRow(container, 'admin').textContent).toContain('admin grants read on no schema.');
	});

	it('reports a partial grant as some and a wildcard grant as every schema', () => {
		const { container } = setupWith(
			[rule('editor', 'article', ['read']), rule('reviewer', '*', ['read'])],
			['article', 'page'],
		);
		expect(roleRow(container, 'editor').textContent).toContain(
			'editor grants read on some schemas.',
		);
		expect(roleRow(container, 'reviewer').textContent).toContain(
			'reviewer grants read on every schema.',
		);
	});

	it('summarizes a collapsed role', async () => {
		const { container } = setupWith([rule('editor', 'article', ['read'])], ['article', 'page']);
		const button = container.querySelector(
			'button[aria-controls="rules-editor"]',
		) as HTMLButtonElement;
		await fireEvent.click(button);

		expect(container.querySelectorAll('#rules-editor tr').length).toBe(0);
		expect(roleRow(container, 'editor').textContent).toContain(
			'editor grants read on some schemas.',
		);
		expect(roleRow(container, 'editor').textContent).toContain(
			'editor grants create on no schema.',
		);
	});
});

describe('permissions page inherited grants', () => {
	it('names the wildcard rule as the source of an inherited grant', () => {
		// GetEffective unions the schema row's actions with the wildcard row's,
		// so a grant the wildcard makes cannot be revoked on one schema.
		const { container } = setupWith(
			[rule('editor', '*', ['read']), rule('editor', 'article', ['create'])],
			['article'],
		);
		const row = childRow(container, 'editor', 'article');
		expect(row.textContent).toContain(
			'editor is granted read on article by the wildcard rule. Clearing this rule does not revoke it.',
		);
		expect(row.textContent).toContain('editor is granted create on article by this rule.');
	});

	it('warns in the editor that clearing an inherited action revokes nothing', async () => {
		const { container, getAllByRole } = setupWith(
			[rule('editor', '*', ['read']), rule('editor', 'article', ['create'])],
			['article'],
		);
		const edit = getAllByRole('button').find(
			(b) => b.getAttribute('aria-label') === 'Edit rule for editor on article',
		);
		await fireEvent.click(edit!);

		const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
		expect(dialog.textContent).toContain('does not revoke it');
	});

	it('tells the operator a removal leaves the inherited grant standing', async () => {
		const { container, getAllByRole } = setupWith(
			[rule('editor', '*', ['read']), rule('editor', 'article', ['create'])],
			['article'],
		);
		const remove = getAllByRole('button').find(
			(b) => b.getAttribute('aria-label') === 'Remove rule for editor on article',
		);
		await fireEvent.click(remove!);

		await tick();
		const [, message] = kit.confirm.mock.calls[0] as unknown as [string, string];
		expect(message).toContain('still grants read on this schema');
	});
});

describe('permissions page exempt role', () => {
	it('marks super_admin exempt and keeps its rows reachable', () => {
		const { container } = setupWith([rule('super_admin', 'article', ['read'])], ['article']);
		const row = roleRow(container, 'super_admin');
		expect(row.textContent).toContain('Exempt');
		// Hiding the role would hide rules that exist in the database.
		expect(container.querySelectorAll('#rules-super_admin tr').length).toBeGreaterThan(0);
	});

	it('offers no grant control under super_admin', () => {
		// checkPermission answers true for super_admin before it reads a rule,
		// so a control that writes one is offering a change with no effect.
		const { container, getAllByRole } = setupWith(
			[rule('super_admin', 'article', ['read'])],
			['article'],
		);
		const add = getAllByRole('button').find(
			(b) => b.getAttribute('aria-label') === 'Add a schema rule for super_admin',
		);
		expect((add as HTMLButtonElement).disabled).toBe(true);

		const edit = getAllByRole('button').find(
			(b) => b.getAttribute('aria-label') === 'Edit rule for super_admin on article',
		);
		expect((edit as HTMLButtonElement).disabled).toBe(true);

		const row = childRow(container, 'super_admin', 'article');
		expect(row.textContent).toContain('The role is exempt from these rules.');
	});
});

describe('permissions page schema filter', () => {
	it('narrows the child rows to the schemas that match', async () => {
		const { container } = setupWith(
			[rule('editor', 'article', ['read']), rule('editor', 'product', ['read'])],
			['article', 'product'],
		);
		expect(container.querySelectorAll('#rules-editor tr').length).toBe(3);

		const search = container.querySelector('input[type="search"]') as HTMLInputElement;
		await fireEvent.input(search, { target: { value: 'prod' } });

		const rows = [...container.querySelectorAll('#rules-editor tr')];
		// The wildcard rule stays pinned: it is what a matched schema inherits from.
		expect(rows.length).toBe(2);
		expect(rows.some((r) => r.textContent?.includes('product'))).toBe(true);
		expect(rows.some((r) => r.textContent?.includes('article'))).toBe(false);
	});
});

describe('permissions page copy', () => {
	it('says a missing rule denies', () => {
		// The gate skips every role whose rule is missing and answers 403 when
		// none granted the action, so a row with no entry is not unrestricted.
		const { container } = setupWith([], ['article']);
		expect(container.textContent).toContain('denied every action on it');
		expect(container.textContent).not.toContain('unrestricted');
	});
});

describe('permissions page flow resources', () => {
	function setupFlows(permissions: Rule[], schemas: string[] = ['article'], flows = [{ id: 'f1', slug: 'send-receipt', name: 'Send receipt' }]) {
		return render(PermissionsPage, {
			props: {
				data: { permissions, schemas: schemas.map((name) => ({ name })), flows, entitlements, loadError: null },
				form: null,
			} as never,
		});
	}

	it('offers All flows and each flow as resources beside the schemas', async () => {
		const { container } = setupFlows([rule('editor', 'article', ['read'])]);
		await fireEvent.click(container.querySelector('button[aria-label="Add a schema rule for editor"]') as HTMLButtonElement);
		await tick();
		const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
		const picker = (dialog.querySelector('input[role="combobox"]') ?? dialog.querySelector('input:not([type="hidden"])')) as HTMLInputElement;
		expect(picker).toBeTruthy();
		await fireEvent.focus(picker);
		await fireEvent.input(picker, { target: { value: 'flow' } });
		await tick();
		const options = [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent?.trim());
		expect(options).toContain('All flows');
		expect(options).toContain('flow send-receipt');
	});

	it('shows activate only when the rule names a flow resource', async () => {
		const { container, queryByLabelText } = setupFlows([rule('editor', 'article', ['read']), rule('publisher', 'flows', ['read'])]);
		await fireEvent.click(container.querySelector('button[aria-label="Edit rule for editor on article"]') as HTMLButtonElement);
		await tick();
		expect(queryByLabelText('Activate')).toBeNull();
		expect(queryByLabelText('Read')).toBeTruthy();
		await fireEvent.click(container.querySelector('button[aria-label="Edit rule for publisher on All flows"]') as HTMLButtonElement);
		await tick();
		expect(queryByLabelText('Activate')).toBeTruthy();
	});

	it('draws no activate mark on a schema row and inherits a flow row from the All flows rule', () => {
		const { container } = setupFlows([rule('publisher', 'flows', ['read', 'activate']), rule('publisher', 'flow:send-receipt', ['update'])]);
		const flowRow = childRow(container, 'publisher', 'flow:send-receipt');
		expect(flowRow.textContent).toContain('publisher is granted activate on flow send-receipt by the All flows rule.');
		expect(flowRow.textContent).toContain('publisher is granted update on flow send-receipt by this rule.');
		const all = childRow(container, 'publisher', 'flows');
		expect(all.textContent).toContain('Every flow');
		expect(all.textContent).toContain('publisher is granted activate on All flows by this rule.');
	});

	it('keeps the wildcard rule away from flows in the summary', () => {
		const { container } = setupFlows([rule('reviewer', '*', ['read'])], ['article', 'page']);
		expect(roleRow(container, 'reviewer').textContent).toContain('reviewer grants read on every schema.');
		expect(roleRow(container, 'reviewer').textContent).toContain('reviewer grants read on no flow.');
		expect(roleRow(container, 'reviewer').textContent).toContain('reviewer grants activate on no flow.');
	});
});
