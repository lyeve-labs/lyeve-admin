// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));
vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/admin/logs/alerts') } }));

import AlertsPage from './+page.svelte';

afterEach(cleanup);

const CONFIG = {
	thresholds: [
		{
			id: 'r1',
			level: 'ERROR',
			tenant_id: '',
			plugin: '',
			max_count: 100,
			window: '5m',
			enabled: true,
			channels: { email: ['ops@example.com'], pagerduty_routing_key: '...cdef' },
		},
	],
	cooldown: '10m',
	licensed: false,
};

function setup(over: Record<string, unknown> = {}, form: unknown = null) {
	return render(AlertsPage, {
		props: { data: { gate: { state: 'ok' }, config: CONFIG, superAdmin: true, ...over }, form } as never,
	});
}

describe('the volume alert rules', () => {
	it('lists each rule with what it watches and where it goes', () => {
		const { container } = setup();
		const row = container.querySelector('[data-testid="rule-row"]') as HTMLElement;
		expect(row.textContent).toContain('ERROR entries');
		expect(row.querySelector('[data-testid="rule-channels"]')?.textContent).toBe('1 email, PagerDuty');
	});

	it('opens a rule in the drawer with its stored channel, open after a lapse', async () => {
		const { container, getByRole } = setup();
		await fireEvent.click(getByRole('button', { name: 'Edit rule 1' }));
		const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
		expect((dialog.querySelector('input[name="key"]') as HTMLInputElement).value).toBe('r1');
		expect((dialog.querySelector('#log-rule-channel-pagerduty') as HTMLInputElement).disabled).toBe(false);
		expect((dialog.querySelector('#log-rule-channel-slack') as HTMLInputElement).disabled).toBe(true);
	});

	it('gives a tenant admin the rules to read and nothing to write', () => {
		const { container, queryByRole } = setup({ superAdmin: false });
		expect(queryByRole('button', { name: /new rule/i })).toBeNull();
		expect(queryByRole('button', { name: 'Edit rule 1' })).toBeNull();
		expect(container.textContent).toContain('A super admin writes them.');
	});

	it('says there is no rule rather than that the read failed', () => {
		const { container } = setup({ config: { ...CONFIG, thresholds: [] } });
		expect(container.textContent).toContain('No volume rule');
	});

	it('renders a refusal from a write outside the drawer over the page', () => {
		const { container } = setup({}, {
			error: 'refused',
			refused: { kind: 'feature', feature: 'example-feature', plugin: 'logging', upgradeUrl: '' },
		});
		expect(container.querySelector('[data-testid="refusal-notice"]')).not.toBeNull();
	});
});
