// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));
vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn(async () => {}) }));
const app = vi.hoisted(() => ({
	page: { url: new URL('http://admin/admin/forms') },
	navigating: { to: null as null | { url: URL } },
}));
vi.mock('$app/state', () => app);

import Page from './+page.svelte';
import type { FlowTarget, PublishedForm } from '$lib/api/builder-forms';

afterEach(cleanup);
beforeEach(() => {
	app.navigating.to = null;
});

function said(): string {
	return (document.body.textContent ?? '').replace(/\s+/g, ' ');
}

function published(over: Partial<PublishedForm> = {}): PublishedForm {
	return {
		site: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
		site_name: 'Main site',
		path: '/contact',
		block: 'b1',
		label: 'Contact us',
		destination: { schema: 'contact_messages' },
		counts: { new: 3, read: 1, spam: 0 },
		...over,
	};
}

function flow(over: Partial<FlowTarget> = {}): FlowTarget {
	return { id: 'f1', slug: 'notify', name: 'Notify sales', status: 'active', formTrigger: true, ...over };
}

const SETTINGS = {
	allowed: true,
	lifetime_days: 90,
	show_schemas: [],
	writes_per_minute: 120,
	max_writes_per_minute: 120,
	form_schemas: ['contact_messages'],
	form_flows: ['notify'],
};

const SCHEMAS = [{ name: 'contact_messages', label: 'Contact messages', delivered: false }];

function props(over: Record<string, unknown> = {}, form: unknown = null) {
	return {
		data: {
			gate: { state: 'ok' },
			forms: [published()],
			settings: { ok: true, value: SETTINGS },
			schemas: { ok: true, value: SCHEMAS },
			flows: { ok: true, value: [flow()] },
			presetOffered: true,
			selected: null,
			...over,
		} as never,
		form: form as never,
	};
}

describe('the forms list', () => {
	it('draws a failed read as a failure with a way to try again, never as no forms', () => {
		render(Page, { props: props({ gate: { state: 'unavailable' }, forms: [] }) });
		expect(said()).not.toContain('No forms yet');
		expect(document.querySelector('a[data-sveltekit-reload]')?.textContent).toContain('Try again');
	});

	it('says an older builder plugin cannot show forms', () => {
		render(Page, { props: props({ gate: { state: 'absent' }, forms: [] }) });
		expect(said()).toContain('Forms need a newer version of the builder plugin.');
	});

	it('shows the first-run words when no form is published', () => {
		render(Page, { props: props({ forms: [] }) });
		expect(said()).toContain('No forms yet');
		expect(said()).toContain('Forms on pages you publish from the builder appear here.');
	});

	it('lists a form with its site, destination and counts', () => {
		render(Page, { props: props() });
		expect(said()).toContain('Contact us');
		expect(said()).toContain('Main site');
		expect(said()).toContain('Contact messages');
		expect(document.querySelector('a[href*="block=b1"]')?.textContent).toContain('View submissions');
		expect(document.querySelector('[data-testid="form-warning"]')).toBeNull();
	});

	it('shows the site id only when the site is gone', () => {
		render(Page, { props: props({ forms: [published({ site_name: '' })] }) });
		expect(said()).toContain('Deleted site 7c9e6679-7425-40de-944b-e07fc1f90ae7');
	});

	it.each([
		{ why: 'is not active', flows: [flow({ status: 'disabled' })], text: 'The flow Notify sales is not active, so posts to this form start nothing.' },
		{ why: 'has another trigger', flows: [flow({ formTrigger: false })], text: 'The flow Notify sales does not start from a builder form, so posts to this form start nothing.' },
		{ why: 'is gone', flows: [], text: 'The flow notify no longer exists, so posts to this form start nothing.' },
	])('warns on a form whose flow $why', ({ flows, text }) => {
		render(Page, { props: props({ forms: [published({ destination: { flow: 'notify' } })], flows: { ok: true, value: flows } }) });
		expect(document.querySelector('[data-testid="form-warning"]')?.textContent).toContain(text);
	});
});

describe('where forms can send', () => {
	it('offers only flows a form can start, and names the problem beside an allowed slug', () => {
		render(Page, {
			props: props({
				settings: { ok: true, value: { ...SETTINGS, form_flows: ['notify', 'gone'] } },
				flows: { ok: true, value: [flow(), flow({ id: 'f2', slug: 'nightly', name: 'Nightly report', formTrigger: false })] },
			}),
		});
		expect(said()).toContain('Notify sales');
		expect(said()).not.toContain('Nightly report');
		expect(said()).toContain('No flow uses this slug any more. Clear it, then save.');
	});

	it('says the flow plugin is not running instead of offering no flows', () => {
		render(Page, { props: props({ flows: null }) });
		expect(said()).toContain('The flow plugin is not running on this instance, so forms cannot start flows.');
	});

	it('draws a failed flow read as a failure', () => {
		render(Page, { props: props({ flows: { ok: false, gate: { state: 'error', message: 'Could not load flows.' } } }) });
		expect(said()).toContain('Could not load flows.');
	});
});

describe('setup in one step', () => {
	const empty = { settings: { ok: true, value: { ...SETTINGS, form_schemas: [] } }, schemas: { ok: true, value: [] } };

	it('offers to create a content type for form posts while none is allowed', () => {
		render(Page, { props: props(empty) });
		const setup = document.querySelector('[data-testid="setup"]');
		expect(setup?.textContent).toContain('Create a content type for form posts');
		expect(setup?.querySelector('form[action="?/setup"]')).not.toBeNull();
	});

	it('only allows the contact type when it exists already', () => {
		render(Page, { props: props({ ...empty, schemas: { ok: true, value: SCHEMAS } }) });
		expect(said()).toContain('Let forms save posts into the Contact messages content type you already have.');
	});

	it('links the schema builder when the preset is missing', () => {
		render(Page, { props: props({ ...empty, presetOffered: false }) });
		expect(document.querySelector('form[action="?/setup"]')).toBeNull();
		expect(document.querySelector('a[href="/admin/schema"]')?.textContent).toContain('Open the schema builder');
	});

	it('swaps the action for the link after the preset route answers 404', () => {
		render(Page, { props: props(empty, { setupMissing: true }) });
		expect(document.querySelector('form[action="?/setup"]')).toBeNull();
		expect(document.querySelector('a[href="/admin/schema"]')).not.toBeNull();
	});

	it('is not offered once a content type is allowed', () => {
		render(Page, { props: props() });
		expect(document.querySelector('[data-testid="setup"]')).toBeNull();
	});
});

describe('one form', () => {
	const ref = { site: 's1', path: '/contact', block: 'b1' };
	const submission = { id: 'e1', schema: 'contact_messages', state: 'new', created_at: '2026-11-07T10:00:00Z', fields: { email: 'ana@example.com' } };

	it('lists submissions with the filter, the export link and the triage actions', () => {
		render(Page, {
			props: props({
				selected: { ref, state: 'new', limit: 50, offset: 0, form: published(), submissions: { ok: true, value: { data: [submission], total: 1, limit: 50, offset: 0 } } },
			}),
		});
		expect(said()).toContain('ana@example.com');
		expect(document.querySelector('a[href^="/admin/forms/export?"]')?.getAttribute('href')).toBe('/admin/forms/export?site=s1&path=%2Fcontact&block=b1');
		const states = [...document.querySelectorAll('form[action="?/state"] input[name="state"]')].map((i) => (i as HTMLInputElement).value);
		expect(states).toEqual(['read', 'spam']);
		expect(document.querySelector('form[action="?/delete"]')).not.toBeNull();
	});

	it('draws a failed submissions read as a failure, never as no submissions', () => {
		render(Page, {
			props: props({ selected: { ref, state: 'new', limit: 50, offset: 0, form: published(), submissions: { ok: false, gate: { state: 'unavailable' } } } }),
		});
		expect(said()).not.toContain('No submissions');
		expect(document.querySelector('a[data-sveltekit-reload]')?.textContent).toContain('Try again');
	});

	it('offers to clear a filter that matches nothing', () => {
		render(Page, {
			props: props({ selected: { ref, state: 'spam', limit: 50, offset: 0, form: published(), submissions: { ok: true, value: { data: [], total: 0, limit: 50, offset: 0 } } } }),
		});
		expect(said()).toContain('No submissions match this filter');
		const show = [...document.querySelectorAll('a')].find((a) => a.textContent?.trim() === 'Show all');
		expect(show?.getAttribute('href')).toBe('/admin/forms?site=s1&path=%2Fcontact&block=b1&state=all');
	});
});
