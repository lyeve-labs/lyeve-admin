// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';

import FlowGuide from './FlowGuide.svelte';

afterEach(cleanup);

describe('FlowGuide', () => {
	it('lists every name an expression can read', () => {
		render(FlowGuide, { props: {} });
		const table = screen.getByRole('table');
		const names = [...table.querySelectorAll('tbody tr td:first-child')].map((c) => c.textContent);
		expect(names).toEqual(['trigger', 'input', 'inputs', 'nodes', 'vars', 'run', 'now()']);
	});

	it('describes the templates the engine offers, with the guide note where one is written', () => {
		const templates = [
			{ id: 'nightly-sheet-export', name: 'Nightly sheet export', description: 'unused' },
			{ id: 'custom-one', name: 'Custom one', description: 'Its own description.' },
		];
		const { container } = render(FlowGuide, { props: { templates: templates as never } });
		expect(container.textContent).toContain('Nightly sheet export.');
		expect(container.textContent).toContain('A cron trigger at 02:00');
		expect(container.textContent).not.toContain('unused');
		expect(container.textContent).toContain('Its own description.');
	});

	it('falls back to the notes it knows when the engine named no template', () => {
		const { container } = render(FlowGuide, { props: { templates: [] } });
		expect(container.textContent).toContain('join-three-tables-api.');
		expect(container.textContent).toContain('enrich-on-create.');
	});
});
