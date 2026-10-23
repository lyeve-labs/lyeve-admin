// @vitest-environment jsdom
import { render, cleanup, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));
vi.mock('$app/state', () => ({ page: { url: new URL('http://admin/admin/settings/privacy') } }));

import PrivacyPage from './+page.svelte';
import { NO_TENANT } from '$lib/api/privacy';

afterEach(cleanup);

function said(c: HTMLElement): string {
	return (c.textContent ?? '').replace(/\s+/g, ' ');
}

const props = (data: Record<string, unknown>, form: unknown = null) => ({
	data: { noTenant: false, formErasure: { ok: true, value: { mode: 'auto' } }, ...data } as never,
	form: form as never,
});

describe('privacy settings: form submissions on erasure', () => {
	it('shows the stored mode as chosen, with a sentence for each mode', () => {
		const { container } = render(PrivacyPage, { props: props({ formErasure: { ok: true, value: { mode: 'hard' } } }) });
		const chosen = container.querySelector('input[name="mode"]:checked') as HTMLInputElement;
		expect(chosen.value).toBe('hard');
		expect(said(container)).toContain("When it also holds someone else's address, clear only the person's own values.");
		expect(said(container)).toContain('No submission is deleted.');
	});

	it('draws a failed read as a failure with a way to try again', () => {
		const { container } = render(PrivacyPage, {
			props: props({ formErasure: { ok: false, gate: { state: 'error', message: 'It could not be read.' } } }),
		});
		expect(said(container)).toContain('It could not be read.');
		expect(screen.getByRole('link', { name: /try again/i })).toBeTruthy();
		expect(container.querySelector('input[name="mode"]')).toBeNull();
	});

	it('leaves the setting out while its routes do not answer', () => {
		const { container } = render(PrivacyPage, { props: props({ formErasure: null }) });
		expect(said(container)).not.toContain('Form submissions on erasure');
		expect(said(container)).toContain('None of these settings apply to this instance');
	});

	it('says why the card is empty while its plugin is stopped', () => {
		const { container } = render(PrivacyPage, {
			props: props({ formErasure: { ok: false, stopped: { state: 'not-built' } } }),
		});
		const notice = screen.getByTestId('not-running');
		expect(notice.dataset.state).toBe('not-built');
		expect(said(container)).toContain('Form submissions on erasure');
		expect(container.querySelector('input[name="mode"]')).toBeNull();
		expect(said(container)).not.toContain('None of these settings apply');
	});

	it('says once that the session names no tenant, with nothing to retry and no card', () => {
		const { container } = render(PrivacyPage, { props: props({ noTenant: true, formErasure: null }) });
		expect(said(container).split(NO_TENANT)).toHaveLength(2);
		expect(screen.queryByRole('link', { name: /try again/i })).toBeNull();
		expect(container.querySelector('form')).toBeNull();
		expect(said(container)).not.toContain('None of these settings apply');
	});

	it('confirms a save with a confirmation that clears itself', () => {
		const { container } = render(PrivacyPage, { props: props({}, { action: 'erasure', saved: true }) });
		expect(said(container)).toContain('Saved. The next erasure in this tenant follows this choice.');
	});

	it('shows a failed save on the form that made it', () => {
		const { container } = render(PrivacyPage, {
			props: props({}, { action: 'erasure', error: 'The choice could not be saved.' }),
		});
		expect(said(container)).toContain('The choice could not be saved.');
		expect(said(container)).not.toContain('Saved.');
	});
});
