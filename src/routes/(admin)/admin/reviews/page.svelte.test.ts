// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PageData } from './$types';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

import ReviewsPage from './+page.svelte';

afterEach(cleanup);

const definition = {
	definition: {
		id: 'd1',
		name: 'Editorial',
		slug: 'editorial',
		content_schema: 'article',
		publish_on_approve: true,
		created_at: '',
		updated_at: '',
	},
	stages: [
		{ id: 's1', definition_id: 'd1', name: 'Copy edit', position: 1, required_role: 'editor', sla_duration_seconds: 3600 },
		{ id: 's2', definition_id: 'd1', name: 'Sign-off', position: 2, required_role: '', sla_duration_seconds: 0 },
	],
};

const assignment = {
	id: 'a1',
	entry_id: 'e1e1e1e1-0000-0000-0000-000000000000',
	definition_id: 'd1',
	current_stage_id: 's2',
	assignee_id: '22222222-2222-2222-2222-222222222222',
	assigned_by: '',
	assigned_at: '',
	status: 'in_review',
	due_at: '2020-01-01T00:00:00Z',
	overdue_at: null,
	overdue: true,
	assignee_ids: [],
	approvals: [],
	required_approvals: 1,
	created_at: '',
	updated_at: '',
};

/** A test names each read's rows as an array. The load hands the page a read that succeeded, or the gate of one that failed. */
function read(value: unknown) {
	return Array.isArray(value) ? { ok: true, value } : value;
}

function data(overrides: Record<string, unknown> = {}): PageData {
	const merged: Record<string, unknown> = {
		operator: true,
		definitions: [definition],
		assignments: [assignment],
		total: 1,
		offset: 0,
		limit: 50,
		status: '',
		schemas: ['article'],
		entries: {},
		entriesNamed: true,
		people: {},
		...overrides,
	};
	for (const key of ['definitions', 'assignments', 'schemas']) merged[key] = read(merged[key]);
	return merged as unknown as PageData;
}

describe('reviews page', () => {
	it('lists a definition with its ordered stages, roles and SLAs', () => {
		render(ReviewsPage, { props: { data: data(), form: null } });
		expect(screen.getByText('Beta')).toBeTruthy();
		const row = screen.getByTestId('definition-row');
		expect(row.textContent).toContain('Editorial');
		expect(row.textContent).toContain('editorial');
		expect(row.textContent).toMatch(/1\.\s*Copy edit\s*editor\s*1h/);
		expect(row.textContent).toMatch(/2\.\s*Sign-off/);
		expect(row.textContent).toContain('Publishes');
		expect(screen.getByRole('button', { name: 'Delete Editorial' })).toBeTruthy();
	});

	it('lists an assignment with its stage, status, overdue due date and a link to the entry', () => {
		render(ReviewsPage, { props: { data: data(), form: null } });
		const row = screen.getByTestId('assignment-row');
		expect(row.getAttribute('data-status')).toBe('in_review');
		expect(row.textContent).toContain('Sign-off');
		expect(row.textContent).toContain('Editorial');
		expect(row.textContent).toContain('Overdue');
		const link = row.querySelector('a') as HTMLAnchorElement;
		expect(link.getAttribute('href')).toBe('/admin/content/article/e1e1e1e1-0000-0000-0000-000000000000');
	});

	it('names the entry by its title and the assignee by their email', () => {
		render(ReviewsPage, {
			props: {
				data: data({
					entries: { [assignment.entry_id]: 'Spring launch notes' },
					people: { [assignment.assignee_id]: 'mira.costa@example.com' },
				}),
				form: null,
			},
		});
		const row = screen.getByTestId('assignment-row');
		expect((row.querySelector('a') as HTMLAnchorElement).textContent).toBe('Spring launch notes');
		expect(row.textContent).toContain('mira.costa@example.com');
		expect(row.textContent).not.toContain('e1e1e1e1');
		expect(row.textContent).not.toContain('22222222');
	});

	it('falls back to the short ids when the page could not read the names', () => {
		render(ReviewsPage, { props: { data: data(), form: null } });
		const row = screen.getByTestId('assignment-row');
		expect(row.textContent).toContain('e1e1e1e1');
		expect(row.textContent).toContain('22222222');
	});

	it('counts the assignments in the pager, not the definitions', () => {
		const second = { ...assignment, id: 'a2' };
		render(ReviewsPage, { props: { data: data({ assignments: [assignment, second], total: 2 }), form: null } });
		const section = screen.getByRole('region', { name: 'Assignments' });
		expect(section.textContent).toContain('assignments 1 to 2 of 2');
		expect(section.textContent).not.toContain('definitions 1');
	});

	it('shows the approvals a quorum stage holds and the other assignees', () => {
		const quorum = {
			...assignment,
			assignee_ids: [assignment.assignee_id, '33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444'],
			approvals: ['33333333-3333-3333-3333-333333333333'],
			required_approvals: 2,
		};
		render(ReviewsPage, { props: { data: data({ assignments: [quorum] }), form: null } });
		const row = screen.getByTestId('assignment-row');
		expect(row.textContent).toContain('1 of 2 approvals');
		expect(row.textContent).toContain('and 2 more');
	});

	it('shows no approval count on a single-approval stage', () => {
		render(ReviewsPage, { props: { data: data(), form: null } });
		expect(screen.getByTestId('assignment-row').textContent).not.toContain('approvals');
	});

	it('filters by status through links the engine reads', () => {
		render(ReviewsPage, { props: { data: data(), form: null } });
		const group = screen.getByRole('group', { name: 'Status' });
		const hrefs = Array.from(group.querySelectorAll('a')).map((a) => a.getAttribute('href'));
		expect(hrefs).toContain('/admin/reviews?status=changes_requested');
		expect(hrefs).toContain('/admin/reviews');
	});

	it('hides the definitions from a reviewer who is not an operator', () => {
		render(ReviewsPage, { props: { data: data({ operator: false, definitions: [] }), form: null } });
		expect(screen.queryByRole('region', { name: 'Definitions' })).toBeNull();
		expect(screen.queryByRole('button', { name: /New definition/ })).toBeNull();
		expect(screen.getByTestId('assignment-row')).toBeTruthy();
	});

	it('lists an editor reviewer\'s queue by entry id and says why there are no titles', () => {
		render(ReviewsPage, {
			props: { data: data({ operator: false, definitions: [], entriesNamed: false }), form: null },
		});
		expect(screen.getByText(/Entries, definitions and stages are listed by ID/)).toBeTruthy();
		const row = screen.getByTestId('assignment-row');
		expect(row.textContent).toContain('e1e1e1e1');
		expect(row.querySelector('a')).toBeNull();
	});

	it('names the read that failed in its own section, never the first-run state', () => {
		render(ReviewsPage, {
			props: {
				data: data({
					assignments: { ok: false, gate: { state: 'unavailable' } },
					definitions: { ok: false, gate: { state: 'error', message: 'The review definitions could not be read.' } },
				}),
				form: null,
			},
		});
		expect(screen.getByText(/review assignments could not be read/)).toBeTruthy();
		expect(screen.getByText('The review definitions could not be read.')).toBeTruthy();
		expect(screen.queryByText('Nothing under review')).toBeNull();
		expect(screen.queryByText('No definition yet')).toBeNull();
		expect(screen.queryByRole('button', { name: /New definition/ })).toBeNull();
	});

	it('says when the rules refuse the assignment list', () => {
		render(ReviewsPage, { props: { data: data({ assignments: { ok: false, gate: { state: 'forbidden' } } }), form: null } });
		expect(screen.getByText('You may not list reviews')).toBeTruthy();
	});

	it('serializes the drawer stages in order into one field', async () => {
		render(ReviewsPage, { props: { data: data(), form: null } });
		await fireEvent.click(screen.getByRole('button', { name: /New definition/ }));
		const hidden = () => JSON.parse((document.querySelector('input[name="stages"]') as HTMLInputElement).value);
		expect(hidden()).toEqual([
			{
				name: '',
				required_role: '',
				sla_duration_seconds: 0,
				quorum: 1,
				escalate_kind: 'none',
				escalate_to: '',
				condition_field: '',
				condition_op: 'equals',
				condition_value: '',
			},
		]);
		await fireEvent.input(screen.getByRole('textbox', { name: /Stage name/ }), { target: { value: 'Copy edit' } });
		await fireEvent.click(screen.getByRole('button', { name: 'New stage' }));
		const names = screen.getAllByRole('textbox', { name: /Stage name/ });
		await fireEvent.input(names[1], { target: { value: 'Sign-off' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Move stage 2 up' }));
		expect(hidden().map((s: { name: string }) => s.name)).toEqual(['Sign-off', 'Copy edit']);
		expect((document.querySelector('input[name="publish_on_approve"]') as HTMLInputElement).value).toBe('true');
	});

	it('reports the refusal and the outcome', () => {
		render(ReviewsPage, { props: { data: data(), form: { error: 'Stage 2 needs a name.' } as never } });
		expect(screen.getByText('Stage 2 needs a name.')).toBeTruthy();
		cleanup();
		render(ReviewsPage, { props: { data: data(), form: { created: true } as never } });
		expect(screen.getByText('Definition created.')).toBeTruthy();
	});
});

const quorumStage = {
	id: 's3',
	definition_id: 'd1',
	name: 'Legal',
	position: 3,
	required_role: 'legal',
	sla_duration_seconds: 7200,
	quorum: 2,
	escalate_to_user_id: '',
	escalate_to_role: 'legal-lead',
	condition: { field: 'category', op: 'equals', value: 'legal' },
};

describe('reviews page, what the install allows', () => {
	it('states the workflow count against the ceiling the read sent', () => {
		render(ReviewsPage, {
			props: { data: data({ limits: { licensed: false, workflows: { limit: 3, current: 1 } } }), form: null },
		});
		expect(screen.getByTestId('workflow-count').textContent).toMatch(/1 of 3\s*workflows/);
		expect(screen.queryByTestId('refusal-notice')).toBeNull();
	});

	it('renders the ceiling as a refusal with its numbers and closes New definition at it', () => {
		render(ReviewsPage, {
			props: { data: data({ limits: { licensed: false, workflows: { limit: 1, current: 1 } } }), form: null },
		});
		expect(screen.getByTestId('refusal-notice').textContent).toContain('1 of 1 workflows are in use');
		const create = screen.getByRole('button', { name: /New definition/ }) as HTMLButtonElement;
		expect(create.disabled).toBe(true);
	});

	it('says nothing about a ceiling when there is none', () => {
		render(ReviewsPage, {
			props: { data: data({ limits: { licensed: true, workflows: { limit: null, current: 4 } } }), form: null },
		});
		expect(screen.queryByTestId('workflow-count')).toBeNull();
		expect(screen.queryByTestId('refusal-notice')).toBeNull();
	});

	it('names a stage quorum, escalation and condition in the list', () => {
		render(ReviewsPage, {
			props: { data: data({ definitions: [{ ...definition, stages: [...definition.stages, quorumStage] }] }), form: null },
		});
		const chips = screen.getAllByTestId('stage-chip').map((c) => c.textContent ?? '');
		expect(chips[2]).toContain('2 approvals');
		expect(chips[2]).toContain('escalates to legal-lead');
		expect(chips[2]).toContain('when category is legal');
	});

	it('closes the paid stage settings when the read says the install would refuse them', async () => {
		render(ReviewsPage, {
			props: { data: data({ limits: { licensed: false, workflows: { limit: 3, current: 1 } } }), form: null },
		});
		await fireEvent.click(screen.getByRole('button', { name: /New definition/ }));
		const quorum = document.querySelector('input[id^="stage-quorum-"]') as HTMLInputElement;
		expect(quorum.disabled).toBe(true);
		expect(document.querySelector('[data-testid="stage-paid-settings"] [data-testid="not-enabled"]')).not.toBeNull();
	});

	it('opens them when it would take them', async () => {
		render(ReviewsPage, {
			props: { data: data({ limits: { licensed: true, workflows: { limit: null, current: 1 } } }), form: null },
		});
		await fireEvent.click(screen.getByRole('button', { name: /New definition/ }));
		expect((document.querySelector('input[id^="stage-quorum-"]') as HTMLInputElement).disabled).toBe(false);
	});

	it('picks the escalation user by email and saves their id', async () => {
		render(ReviewsPage, {
			props: {
				data: data({
					limits: { licensed: true, workflows: { limit: null, current: 1 } },
					people: { 'u-ada': 'ada@example.com', 'u-jon': 'jon@example.com' },
				}),
				form: null,
			},
		});
		await fireEvent.click(screen.getByRole('button', { name: /New definition/ }));
		const sla = document.querySelector('input[id^="stage-sla-"]') as HTMLInputElement;
		await fireEvent.input(sla, { target: { value: '24' } });
		await fireEvent.click(screen.getByRole('radio', { name: 'A user' }));
		expect(screen.queryByRole('textbox', { name: /User id/ })).toBeNull();
		await fireEvent.click(screen.getByRole('combobox', { name: /^User/ }));
		await fireEvent.click(screen.getByRole('option', { name: 'jon@example.com' }));
		const stages = JSON.parse((document.querySelector('input[name="stages"]') as HTMLInputElement).value);
		expect(stages[0]).toMatchObject({ escalate_kind: 'user', escalate_to: 'u-jon' });
	});

	it('keeps the typed id when the page could not read the directory', async () => {
		render(ReviewsPage, {
			props: { data: data({ limits: { licensed: true, workflows: { limit: null, current: 1 } } }), form: null },
		});
		await fireEvent.click(screen.getByRole('button', { name: /New definition/ }));
		await fireEvent.input(document.querySelector('input[id^="stage-sla-"]') as HTMLInputElement, { target: { value: '24' } });
		await fireEvent.click(screen.getByRole('radio', { name: 'A user' }));
		expect(screen.getByRole('textbox', { name: /User id/ })).toBeTruthy();
	});

	it('renders a refused create with the plugin numbers', () => {
		render(ReviewsPage, {
			props: {
				data: data(),
				form: {
					error: 'refused',
					refused: { kind: 'cap', cap: 'review.workflows', limit: 1, current: 1, upgradeUrl: '' },
				} as never,
			},
		});
		expect(screen.getByTestId('refusal-notice').textContent).toContain('1 of 1 workflows are in use');
	});
});

describe('reviews page, failures and unread stages', () => {
	it('says the stages could not be read instead of drawing an empty cell', () => {
		render(ReviewsPage, {
			props: { data: data({ definitions: [{ ...definition, stages: null }] }), form: null },
		});
		expect(screen.getByText('Stages could not be read')).toBeTruthy();
	});

	it('keeps a failed delete out of the New definition drawer', async () => {
		render(ReviewsPage, {
			props: { data: data(), form: { action: 'delete', error: 'Failed to delete the definition.' } as never },
		});
		expect(screen.getAllByText('Failed to delete the definition.')).toHaveLength(1);
		await fireEvent.click(screen.getAllByRole('button', { name: /New definition/ })[0]);
		const drawerForm = document.querySelector('form#definition-form') as HTMLFormElement;
		expect(drawerForm.textContent).not.toContain('Failed to delete the definition.');
		expect(screen.getAllByText('Failed to delete the definition.')).toHaveLength(1);
	});
});

describe('definition stages', () => {
	// Every other column holds its text on one line, so on a phone a stage
	// name got 7px and stacked one or two letters a line.
	it('keeps each stage on one line', () => {
		render(ReviewsPage, { props: { data: data(), form: null } });
		for (const chip of screen.getAllByTestId('stage-chip')) {
			expect(chip.className).toContain('whitespace-nowrap');
		}
	});
});

describe('the definition drawer stages', () => {
	it('keeps the stage name beside its number and wraps the stage buttons as one group', async () => {
		render(ReviewsPage, { props: { data: data(), form: null } });
		await fireEvent.click(screen.getByRole('button', { name: /New definition/ }));
		const field = (document.body.querySelector('input[id^="stage-name-"]') as HTMLElement).closest('.min-w-48') as HTMLElement;
		expect(field.className).toContain('flex-1');
		const row = field.parentElement as HTMLElement;
		expect(row.className).toContain('flex-wrap');
		const group = (document.body.querySelector('[aria-label="Move stage 1 up"]') as HTMLElement).closest('.ms-auto') as HTMLElement;
		expect(group.parentElement).toBe(row);
		for (const name of ['Move stage 1 up', 'Move stage 1 down', 'Remove stage 1']) {
			expect(group.querySelector(`[aria-label="${name}"]`), name).not.toBeNull();
		}
	});
});
