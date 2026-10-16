// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import RulesLegend from './RulesLegend.svelte';

afterEach(cleanup);

describe('RulesLegend', () => {
	it('says what each mark and bar in the matrix stands for', () => {
		const { container } = render(RulesLegend);
		const text = (container.textContent ?? '').replace(/\s+/g, ' ');
		expect(text).toContain('A stored grant draws as a filled dot, an inherited one as a ring and a denied action as a dash.');
		expect(text).toContain('A shield marks a role these rules never limit.');
		expect(text).toContain('half full on some schemas and full on all');
	});

	it('names the exempt role and says a schema rule replaces the wildcard rule', () => {
		const { container } = render(RulesLegend);
		const text = (container.textContent ?? '').replace(/\s+/g, ' ');
		expect(text).toContain('super_admin passes the content gate before any rule is read.');
		expect(text).toContain('A schema rule replaces the wildcard rule on that schema.');
	});
});
