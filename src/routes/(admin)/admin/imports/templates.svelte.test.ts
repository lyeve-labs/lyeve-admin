// @vitest-environment jsdom
import { render, cleanup, screen, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ invalidate: vi.fn(async () => {}), goto: vi.fn(async () => {}) }));
vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));
vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/admin/imports') } }));

import ImportsPage from './+page.svelte';

afterEach(cleanup);

function said(c: HTMLElement): string {
	return (c.textContent ?? '').replace(/\s+/g, ' ');
}

const template = {
	id: 't1',
	name: 'Orders',
	content_type: 'order',
	mode: 'upsert',
	upsert_key: 'entry.slug',
	field_mappings: [
		{ source_field: 'Placed', target_field: 'placed_at', transform: 'date', transform_options: { layout: '02/01/2006' } },
		{ source_field: 'Ref', target_field: 'entry.slug' },
	],
	created_at: '2026-10-01T00:00:00Z',
	updated_at: '2026-10-01T00:00:00Z',
};

const props = (over: Record<string, unknown> = {}, form: unknown = null) => ({
	data: {
		jobs: [],
		total: 0,
		limit: 25,
		offset: 0,
		hasMore: false,
		gate: { state: 'ok' },
		schemas: [{ name: 'order', fields: [{ name: 'placed_at', field_type: 'datetime' }] }],
		detail: null,
		templates: [template],
		templatesRead: true,
		licensed: true,
		...over,
	} as never,
	form: form as never,
});

describe('mapping templates', () => {
	it('lists each template with its columns, transforms and mode', () => {
		const table = () => screen.getAllByRole('region', { name: 'Mapping templates' })[0];
		render(ImportsPage, { props: props() });
		expect(table().textContent).toContain('Orders');
		expect(table().textContent).toContain('Placed, parse a date');
		expect(table().textContent).toContain('Update it, key entry.slug');
	});

	it('shows the empty state when no template is saved', () => {
		const { container } = render(ImportsPage, { props: props({ templates: [] }) });
		expect(said(container)).toContain('No mapping template');
	});

	it('says a failed read failed rather than that there are none', () => {
		const { container } = render(ImportsPage, { props: props({ templates: [], templatesRead: false }) });
		expect(said(container)).toContain('The templates could not be read');
		expect(said(container)).not.toContain('No mapping template');
	});

	it('says what an unlicensed install keeps', () => {
		const { container } = render(ImportsPage, { props: props({ licensed: false }) });
		expect(said(container)).toContain('Saving a template and the date, split and lookup transforms need a license');
	});

	it('opens a stored template in the drawer with its transform', async () => {
		render(ImportsPage, { props: props() });
		await fireEvent.click(screen.getByRole('button', { name: 'Edit Orders' }));
		expect((screen.getByLabelText(/^Name/) as HTMLInputElement).value).toBe('Orders');
		expect((document.getElementById('template-0-layout') as HTMLInputElement | null)?.value).toBe('02/01/2006');
	});

	it('renders a refused save through the refusal notice', () => {
		render(ImportsPage, {
			props: props({}, { error: 'x', refused: { kind: 'feature', feature: 'example-feature', plugin: 'example', upgradeUrl: '' } }),
		});
		expect(screen.getAllByTestId('refusal-notice').length).toBeGreaterThan(0);
	});
});

describe('the sources', () => {
	it('names the workbook among the formats', () => {
		const { container } = render(ImportsPage, { props: props() });
		expect(said(container)).toContain('an Excel workbook (XLSX)');
	});
});
