// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));
vi.mock('$app/navigation', () => ({ goto: vi.fn(), invalidateAll: vi.fn(async () => {}) }));
const app = vi.hoisted(() => ({
	page: { url: new URL('http://admin/admin/settings/connected-editors/builder') },
	navigating: { to: null as null | { url: URL } },
}));
vi.mock('$app/state', () => app);

const kit = vi.hoisted(() => ({ confirm: vi.fn(async (_t: string, _b?: string, _o?: unknown) => false) }));
vi.mock('@lyeve-labs/ui-kit', async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return { ...actual, confirm: kit.confirm };
});

import Page from './+page.svelte';
import { SAID } from '$lib/api/connected-editors';

afterEach(cleanup);
beforeEach(() => {
	kit.confirm.mockReset();
	kit.confirm.mockResolvedValue(false);
	app.navigating.to = null;
	Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
});

function said(): string {
	return (document.body.textContent ?? '').replace(/\s+/g, ' ');
}

const SETTINGS = { allowed: true, lifetime_days: 90, show_schemas: ['posts', 'gone'], writes_per_minute: 120, max_writes_per_minute: 120 };

function props(over: Record<string, unknown> = {}, form: unknown = null) {
	return {
		data: {
			gate: { state: 'ok' },
			settings: { ok: true, value: SETTINGS },
			schemas: ['posts', 'products'],
			schemasGate: null,
			...over,
		} as never,
		form: form as never,
	};
}

/** Lets an outcome alert take its text, which it does two frames after it mounts. */
async function frames() {
	await new Promise((r) => setTimeout(r, 50));
	await tick();
}

describe('the page', () => {
	it('carries the strip with Builder settings marked', () => {
		render(Page, { props: props() });
		const tab = [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent?.trim() === 'Builder settings');
		expect(tab?.getAttribute('aria-selected')).toBe('true');
	});

	it('shows four skeleton rows while the settings load', () => {
		app.navigating.to = { url: new URL('http://admin/admin/settings/connected-editors/builder') };
		const { container } = render(Page, { props: props() });
		expect(container.querySelectorAll('[data-testid="settings-loading"] > *')).toHaveLength(4);
	});

	it.each([
		[{ state: 'absent' }, 'Builder connections are not included in this build.'],
		[{ state: 'withheld' }, SAID.withheld],
	])('draws the area gate in place of the settings', (gate, words) => {
		render(Page, { props: props({ gate, settings: null }) });
		expect(said()).toContain(words);
		expect(said()).not.toContain('Writes a minute for each connection');
	});

	it('says so when the settings route is missing from the plugin', () => {
		render(Page, { props: props({ settings: { ok: false, gate: { state: 'absent' } } }) });
		expect(said()).toContain('Builder settings need a newer version of the builder plugin.');
	});

	it('says so offline and holds every save until the connection returns', async () => {
		render(Page, { props: props() });
		window.dispatchEvent(new Event('offline'));
		await tick();
		expect(said()).toContain("You're offline. Changes on this page wait until you reconnect.");
		const save = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Save') as HTMLButtonElement;
		expect(save.disabled).toBe(true);
		window.dispatchEvent(new Event('online'));
		await tick();
		expect(said()).not.toContain("You're offline.");
	});
});

describe('the settings card', () => {
	it('draws a refused settings read as a failure', () => {
		render(Page, { props: props({ settings: { ok: false, gate: { state: 'unavailable' } } }) });
		expect(said()).toContain('builder settings did not load');
	});

	it('states that the builder is off, and keeps saying it', () => {
		render(Page, { props: props({ settings: { ok: true, value: { ...SETTINGS, allowed: false } } }) });
		expect(said()).toContain('The builder is off. Connected browsers cannot save.');
		// A standing condition is no outcome, so it never clears itself.
		const live = [...document.querySelectorAll('[aria-live="polite"]')].some((a) => a.textContent?.includes('The builder is off'));
		expect(live).toBe(false);
	});

	const allowSwitch = () => document.querySelector('[role="switch"]') as HTMLButtonElement;

	it('switches the builder with a Toggle that applies at once', async () => {
		const submit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {});
		render(Page, { props: props({ settings: { ok: true, value: { ...SETTINGS, allowed: false } } }) });
		expect(allowSwitch().getAttribute('aria-label')).toBe('Enabled');
		expect(allowSwitch().getAttribute('aria-checked')).toBe('false');
		await fireEvent.click(allowSwitch());
		await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
		const form = submit.mock.contexts[0] as HTMLFormElement;
		expect(new FormData(form).get('allowed')).toBe('on');
		// Turning it on asks nothing.
		expect(kit.confirm).not.toHaveBeenCalled();
		submit.mockRestore();
	});

	it('asks before it turns the builder off, and stays on when the person says no', async () => {
		const submit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {});
		render(Page, { props: props() });
		await fireEvent.click(allowSwitch());
		await waitFor(() =>
			expect(kit.confirm).toHaveBeenCalledWith(
				'Turn off the builder?',
				'Connected browsers stop saving immediately.',
				{ confirmLabel: 'Turn off' },
			),
		);
		await tick();
		expect(allowSwitch().getAttribute('aria-checked')).toBe('true');
		expect(submit).not.toHaveBeenCalled();
		submit.mockRestore();
	});

	it('saves the other settings together under one Save', () => {
		render(Page, { props: props() });
		const cards = [...document.querySelectorAll('form[action="?/setting"]')];
		expect(cards).toHaveLength(2);
		const limits = cards.find((f) => f.querySelector('input[name="field"][value="limits"]')) as HTMLFormElement;
		expect(limits.querySelector('[name="lifetime_days"]')).not.toBeNull();
		expect(limits.querySelector('#writes-per-minute')).not.toBeNull();
		expect(limits.querySelector('input[name="schemas_offered"]')).not.toBeNull();
		const saves = [...limits.querySelectorAll('button[type="submit"]')].map((b) => b.textContent?.trim());
		expect(saves).toEqual(['Save']);
		// The switch saves itself, so its card has no Save at all.
		const allowed = cards.find((f) => f !== limits) as HTMLFormElement;
		expect(allowed.querySelector('button[type="submit"]')).toBeNull();
	});

	it('names the lifetime and the write limit in plain words', () => {
		render(Page, { props: props() });
		expect(said()).toContain('Valid for');
		expect(said()).not.toContain('Lasts');
		expect(said()).toContain('Applies to connections approved from now on.');
		expect(said()).toContain('When a connection reaches this limit, the builder waits and saves again.');
	});

	it('draws a failed schema list as a failure, never as none to offer', () => {
		render(Page, {
			props: props({
				schemas: [],
				schemasGate: { state: 'error', message: 'Could not load schemas. Pages keep showing the schemas saved before.' },
			}),
		});
		expect(said()).toContain('Could not load schemas. Pages keep showing the schemas saved before.');
		expect(said()).toContain('Try again');
		expect(said()).not.toContain('Create a schema');
		// Nothing offered, so a Save clears no stored schema.
		expect(document.querySelector('input[name="schemas_offered"]')).toBeNull();
	});

	it('says how to offer a schema when there is none', () => {
		render(Page, { props: props({ schemas: [] }) });
		expect(said()).toContain('Create a schema to show its entries on pages.');
		expect(document.querySelector('input[name="schemas_offered"]')).toBeNull();
	});

	it('drops a schema that no longer exists', () => {
		render(Page, { props: props() });
		const labels = [...document.querySelectorAll('label')].map((l) => l.textContent?.trim());
		expect(labels).toContain('posts');
		expect(labels).not.toContain('gone');
	});

	it('says a setting saved, and lets the words clear themselves', async () => {
		render(Page, { props: props({}, { saved: { field: 'limits', settings: SETTINGS } }) });
		await frames();
		expect(said()).toContain('Settings saved.');
	});

	it('lands a refused value on its field', () => {
		render(Page, {
			props: props({}, { settingError: { field: 'writes_per_minute', message: 'Writes must be between 1 and 120 a minute.' } }),
		});
		expect(said()).toContain('Writes must be between 1 and 120 a minute.');
	});
});
