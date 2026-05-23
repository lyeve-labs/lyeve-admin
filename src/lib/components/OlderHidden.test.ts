// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import OlderHidden from './OlderHidden.svelte';

afterEach(cleanup);

describe('OlderHidden', () => {
	it('states the count and the window the plugin sent', () => {
		const { container } = render(OlderHidden, { props: { count: 12, noun: 'revisions', windowDays: 30 } });
		expect(container.textContent).toContain('12 older revisions');
		expect(container.textContent).toContain('the last 30 days');
	});

	it('names one record in the singular, and no window when none was sent', () => {
		const { container } = render(OlderHidden, { props: { count: 1, noun: 'events' } });
		expect(container.textContent).toContain('1 older event');
		expect(container.textContent).not.toContain('1 older events');
		expect(container.textContent).toContain('a recent window');
	});
});
