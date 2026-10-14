// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RateRule } from '$lib/api/rate-limit';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

import RuleDrawer from './RuleDrawer.svelte';

afterEach(cleanup);

const rule = {
	id: 'r1',
	tenant_id: 'acme',
	endpoint: 'GET /api/content/{schema}',
	rate: 2,
	burst: 8,
	enabled: true,
	kind: 'custom',
	role: 'editor',
	key_by: 'user',
	enforced: true,
	created_at: '2026-09-23T00:00:00Z',
	updated_at: '2026-09-23T00:00:00Z',
} as RateRule;

function setup(over: { error?: string; superAdmin?: boolean } = {}) {
	return render(RuleDrawer, { props: { error: over.error ?? '', routes: [], superAdmin: over.superAdmin ?? true } });
}

const form = () => document.body.querySelector('form#rate-rule-form') as HTMLFormElement | null;
const field = (name: string) => (form() ? new FormData(form()!).get(name) : null);

describe('the rule drawer', () => {
	it('stays shut until the page opens it', () => {
		setup();
		expect(form()).toBeNull();
	});

	it('opens a new rule on the defaults and posts a create', () => {
		const { component } = setup();
		component.openCreate();
		flushSync();
		expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('New rule');
		expect(form()?.getAttribute('action')).toBe('?/create');
		expect(field('id')).toBeNull();
		expect(field('endpoint')).toBe('*');
		expect(field('rate')).toBe('10');
		expect(field('burst')).toBe('20');
		expect(field('enabled')).toBe('true');
		expect(document.body.querySelector('button[form="rate-rule-form"]')?.textContent?.trim()).toBe('Create');
	});

	it('opens a rule for editing with its values and posts an update naming it', () => {
		const { component } = setup();
		component.openEdit(rule);
		flushSync();
		expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('Edit rule');
		expect(form()?.getAttribute('action')).toBe('?/update');
		expect(field('id')).toBe('r1');
		expect(field('endpoint')).toBe('GET /api/content/{schema}');
		expect(field('tenant_id')).toBe('acme');
		expect(field('role')).toBe('editor');
		expect(field('key_by')).toBe('user');
		expect(document.body.querySelector('button[form="rate-rule-form"]')?.textContent?.trim()).toBe('Save');
	});

	it('copies a rule as a new one that arrives switched off on an endpoint not yet taken', () => {
		const { component } = setup();
		component.openDuplicate(rule, [rule.endpoint]);
		flushSync();
		expect(form()?.getAttribute('action')).toBe('?/create');
		expect(field('id')).toBeNull();
		expect(field('enabled')).toBe('false');
		expect(field('endpoint')).not.toBe(rule.endpoint);
		expect(field('key_by')).toBe('user');
	});

	it('asks a super admin for the tenant and nobody else', () => {
		const first = setup();
		first.component.openCreate();
		flushSync();
		expect(document.body.querySelector('#rl-tenant')).toBeTruthy();
		cleanup();
		const second = setup({ superAdmin: false });
		second.component.openCreate();
		flushSync();
		expect(document.body.querySelector('#rl-tenant')).toBeNull();
	});

	it('shows its failure first in its form', () => {
		const { component } = setup({ error: 'The rule could not be saved.' });
		component.openCreate();
		flushSync();
		expect(form()?.firstElementChild?.firstElementChild?.textContent).toContain('The rule could not be saved.');
	});
});
