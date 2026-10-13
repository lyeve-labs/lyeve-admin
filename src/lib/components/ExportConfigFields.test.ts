// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import ExportConfigFields from './ExportConfigFields.svelte';

afterEach(cleanup);

describe('ExportConfigFields schema choice', () => {
	it('says why there is nothing to pick when the schema list was not read', () => {
		const { container } = render(ExportConfigFields, { props: { idPrefix: 'x', schemaNames: null } });
		expect(container.textContent).toContain('The schema list could not be read');
	});

	it('counts the schemas a read answered with', () => {
		const { container } = render(ExportConfigFields, { props: { idPrefix: 'x', schemaNames: ['article', 'page'] } });
		expect(container.textContent).toContain('Every schema, 2 in this tenant.');
		expect(container.textContent).not.toContain('could not be read');
	});
});
