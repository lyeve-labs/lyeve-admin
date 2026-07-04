// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));
vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/admin/observability/errors/alerts') } }));

import SpikePage from './+page.svelte';

afterEach(cleanup);

const BASE = {
	channels: { email: ['ops@example.com'] },
	spike_min_count: null,
	spike_z_score: null,
	defaults: { spike_min_count: 10, spike_z_score: 2.5 },
	licensed: true,
};

function setup(settings: Record<string, unknown> | null, form: unknown = null, gate = { state: 'ok' }) {
	const windowDays = settings && settings.licensed === false ? 30 : null;
	return render(SpikePage, { props: { data: { gate, settings, windowDays }, form } as never });
}

describe('the spike alerts page', () => {
	it('offers every channel and a custom threshold when the plugin says it would take them', () => {
		const { container } = setup(BASE);
		expect((container.querySelector('#spike-pagerduty') as HTMLInputElement).disabled).toBe(false);
		expect(container.querySelector('[data-testid="alert-channels-locked"]')).toBeNull();
		expect(container.querySelector('[data-testid="threshold-locked"]')).toBeNull();
		expect(container.querySelector('[data-testid="event-window"]')).toBeNull();
	});

	it('closes the empty paid channels and the threshold when it would not, and keeps a stored one open', () => {
		const { container } = setup({ ...BASE, licensed: false, channels: { email: ['ops@example.com'], slack_url: 'https://hooks.slack.com/...1a2b' } });
		expect(container.querySelector('[data-testid="alert-channels-locked"]')).not.toBeNull();
		expect((container.querySelector('#spike-slack') as HTMLInputElement).disabled).toBe(false);
		expect((container.querySelector('#spike-discord') as HTMLInputElement).disabled).toBe(true);
		expect((container.querySelector('#spike-pagerduty') as HTMLInputElement).disabled).toBe(true);
		expect(container.querySelector('[data-testid="threshold-locked"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="event-window"]')?.textContent).toContain('30 days');
	});

	it('keeps a stored custom threshold editable after a lapse, so it can go back to the default', () => {
		const { container } = setup({ ...BASE, licensed: false, spike_min_count: 25 });
		expect(container.querySelector('[data-testid="threshold-locked"]')).toBeNull();
		expect((container.querySelector('#spike-min-count') as HTMLInputElement).value).toBe('25');
	});

	it('renders the refusal a save came back with', () => {
		const { container } = setup(BASE, {
			error: 'refused',
			refused: { kind: 'feature', feature: 'example-feature', plugin: 'error-tracking', upgradeUrl: '' },
		});
		expect(container.querySelector('[data-testid="refusal-notice"]')?.textContent).toContain('example-feature');
	});

	it('says why there is nothing to set while the plugin does not run', () => {
		const { container } = setup(null, null, { state: 'absent' } as never);
		expect(container.textContent).toContain('not part of this build');
	});
});
