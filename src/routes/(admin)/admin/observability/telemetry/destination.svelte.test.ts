// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}), invalidateAll: vi.fn(async () => {}) }));
const forms = vi.hoisted(() => ({ submits: new Map<string, unknown>() }));
vi.mock('$app/forms', () => ({
	enhance: (form: HTMLFormElement, submit: unknown) => {
		forms.submits.set(form.getAttribute('action') ?? '', submit);
		return { destroy() {} };
	},
}));

const kit = vi.hoisted(() => ({ confirm: vi.fn(async () => false) }));
vi.mock('@lyeve-labs/ui-kit', async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return { ...actual, confirm: kit.confirm };
});

import TelemetryPage from './+page.svelte';

afterEach(cleanup);

function said(c: HTMLElement): string {
	return (c.textContent ?? '').replace(/\s+/g, ' ');
}

// A stored destination as the plugin answers it. The health is the plugin's
// exporter health, named for the tenant, with Go times that JSON writes as
// the zero time rather than leaving out.
const STORED = {
	kind: 'otlp',
	url: 'https://otlp.example.com/v1/metrics',
	header_names: ['Authorization', 'X-Scope'],
	health: {
		name: 'acme',
		healthy: false,
		last_export: '2026-10-13T08:00:00Z',
		last_failure: '2026-10-14T09:00:00Z',
		last_error: 'pushgateway: HTTP 401: unauthorized',
		last_error_class: 'rejected',
		exports: 3,
		failures: 2,
	},
};

/** The page's data, with the destination read as given. */
function pageData(destination: unknown) {
	const read =
		destination !== null && typeof destination === 'object' && 'ok' in destination
			? destination
			: { ok: true, value: destination };
	return { superAdmin: false, families: { ok: true, value: [] }, exporters: null, destination: read } as never;
}

function props(destination: unknown, form: Record<string, unknown> | null = null) {
	return { data: pageData(destination), form: form as never };
}

describe('the tenant destination', () => {
	it('names the stored headers and never shows a value', () => {
		const { container } = render(TelemetryPage, props({ destination: STORED, licensed: true }));
		expect(said(container)).toContain('Authorization, X-Scope');
		expect(said(container)).toContain('Their values are never shown');
		expect((screen.getByLabelText(/^URL/) as HTMLInputElement).value).toBe(STORED.url);
		expect(said(container)).toContain('Failing');
		expect(said(container)).toContain('HTTP 401: unauthorized');
	});

	it('warns before a save that moves the host while keeping the headers', async () => {
		render(TelemetryPage, props({ destination: STORED, licensed: true }));
		const url = screen.getByLabelText(/^URL/) as HTMLInputElement;
		await fireEvent.input(url, { target: { value: 'https://collector.example.net/v1/metrics' } });
		expect(screen.getByTestId('telemetry-destination').textContent).toContain('the stored headers will not follow it');
	});

	it('explains the refusal to carry the headers to another host', () => {
		const { container } = render(
			TelemetryPage,
			props(
				{ destination: STORED, licensed: true },
				{
					destinationAction: 'save',
					destinationError: 'the destination moved to another host, send its headers again',
					hostMoved: true,
				},
			),
		);
		expect(said(container)).toContain('Send the headers again for the new host');
	});

	it('asks for headers directly when none are stored', () => {
		render(TelemetryPage, props({ destination: null, licensed: true }));
		expect(screen.queryByText('Keep the stored headers')).toBeNull();
		expect(screen.getByRole('button', { name: /Add header/ })).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Delete destination' })).toBeNull();
	});

	it('says what an unlicensed install keeps', () => {
		const { container } = render(TelemetryPage, props({ destination: STORED, licensed: false }));
		expect(said(container)).toContain('needs a license this install does not hold');
		expect(screen.getByRole('button', { name: 'Delete destination' })).toBeTruthy();
	});

	// The form stayed live with Save enabled, so an unlicensed reader filled it
	// in only to be refused on submit.
	it('offers no save the license refuses, and says why beside the button', () => {
		const { container } = render(TelemetryPage, props({ destination: STORED, licensed: false }));
		const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
		expect(save.disabled).toBe(true);
		expect((screen.getByLabelText(/^URL/) as HTMLInputElement).matches(':disabled')).toBe(true);
		expect(said(container)).toContain('Not enabled on this instance.');
		expect((screen.getByRole('button', { name: 'Delete destination' }) as HTMLButtonElement).disabled).toBe(false);
	});

	it('keeps the save live on a licensed install', () => {
		render(TelemetryPage, props({ destination: STORED, licensed: true }));
		expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false);
	});

	it('names the destination in the delete confirmation', async () => {
		render(TelemetryPage, props({ destination: STORED, licensed: true }));
		const submit = forms.submits.get('?/removeDestination') as (i: { cancel: () => void }) => Promise<unknown>;
		await submit({ cancel: vi.fn() });
		expect(kit.confirm).toHaveBeenCalledWith(
			'Delete the destination https://otlp.example.com/v1/metrics?',
			expect.any(String),
			{ confirmLabel: 'Delete' },
		);
	});

	it('renders a refused save through the refusal notice', () => {
		render(
			TelemetryPage,
			props(
				{ destination: null, licensed: false },
				{
					destinationAction: 'save',
					destinationError: 'x',
					refused: { kind: 'feature', feature: 'example-feature', plugin: 'telemetry', upgradeUrl: '' },
				},
			),
		);
		expect(screen.getByTestId('refusal-notice')).toBeTruthy();
	});

	it('reports an unread destination as a failure with its own sentence', () => {
		const message = 'The destination could not be read. This is not a report that none is set.';
		const { container } = render(TelemetryPage, props({ ok: false, gate: { state: 'error', message } }));
		expect(said(container)).toContain(message);
		expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
	});

	it('says the engine did not answer the destination read', () => {
		const { container } = render(TelemetryPage, props({ ok: false, gate: { state: 'unavailable' } }));
		expect(said(container)).toContain('so Tenant destination could not be read');
		expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
	});
});
