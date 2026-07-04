// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}), invalidateAll: vi.fn(async () => {}) }));
vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

import TelemetryPage from './+page.svelte';

afterEach(cleanup);

function said(c: HTMLElement): string {
	return (c.textContent ?? '').replace(/\s+/g, ' ');
}

const STORED = {
	kind: 'otlp',
	url: 'https://otlp.example.com/v1/metrics',
	header_names: ['Authorization', 'X-Scope'],
	health: { healthy: false, last_error: 'status 401', exports: 3, failures: 2 },
};

function props(destination: unknown, form: Record<string, unknown> | null = null) {
	return {
		data: { superAdmin: false, families: [], exporters: null, destination } as never,
		form: form as never,
	};
}

describe('the tenant destination', () => {
	it('names the stored headers and never shows a value', () => {
		const { container } = render(TelemetryPage, props({ destination: STORED, licensed: true }));
		expect(said(container)).toContain('Authorization, X-Scope');
		expect(said(container)).toContain('Their values are never shown');
		expect((screen.getByLabelText(/^URL/) as HTMLInputElement).value).toBe(STORED.url);
		expect(said(container)).toContain('Failing');
		expect(said(container)).toContain('status 401');
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
				{ destinationError: 'the destination moved to another host, send its headers again', hostMoved: true },
			),
		);
		expect(said(container)).toContain('Send the headers again for the new host');
	});

	it('asks for headers directly when none are stored', () => {
		render(TelemetryPage, props({ destination: null, licensed: true }));
		expect(screen.queryByText('Keep the stored headers')).toBeNull();
		expect(screen.getByRole('button', { name: /Add header/ })).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Remove destination' })).toBeNull();
	});

	it('says what an unlicensed install keeps', () => {
		const { container } = render(TelemetryPage, props({ destination: STORED, licensed: false }));
		expect(said(container)).toContain('needs a license this install does not hold');
		expect(screen.getByRole('button', { name: 'Remove destination' })).toBeTruthy();
	});

	it('renders a refused save through the refusal notice', () => {
		render(
			TelemetryPage,
			props(
				{ destination: null, licensed: false },
				{ destinationError: 'x', refused: { kind: 'feature', feature: 'example-feature', plugin: 'example', upgradeUrl: '' } },
			),
		);
		expect(screen.getByTestId('refusal-notice')).toBeTruthy();
	});

	it('reports an unread destination as a failure', () => {
		const { container } = render(TelemetryPage, props(null));
		expect(said(container)).toContain('The destination could not be read');
	});
});
