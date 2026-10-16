// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import FlowExportModal from './FlowExportModal.svelte';

afterEach(cleanup);

function setup(load: (format: 'json' | 'yaml') => Promise<string>) {
	const result = render(FlowExportModal, { props: { name: 'Orders sync', slug: 'orders_sync', load } });
	const show = async () => {
		(result.component as unknown as { show: () => void }).show();
		await tick();
	};
	return { ...result, show };
}

const dialog = () => document.body.querySelector('[role="dialog"]') as HTMLElement | null;

describe('FlowExportModal', () => {
	it('draws nothing until it is shown, then reads the JSON and prints it indented', async () => {
		const load = vi.fn(async () => '{"name":"Orders sync"}');
		const { show } = setup(load);
		expect(dialog()).toBeNull();
		await show();
		expect(load).toHaveBeenCalledWith('json');
		expect(dialog()?.textContent).toContain('Export Orders sync');
		await vi.waitFor(() => expect(document.body.querySelector('pre')?.textContent).toBe('{\n  "name": "Orders sync"\n}'));
		const link = document.body.querySelector('a[download]') as HTMLAnchorElement;
		expect(link.getAttribute('download')).toBe('orders_sync.json');
		expect(link.textContent?.trim()).toBe('Download JSON');
	});

	it('reads the other format when it is picked, and opens on it the next time', async () => {
		const load = vi.fn(async (format: 'json' | 'yaml') => (format === 'json' ? '{}' : 'name: Orders sync\n'));
		const { show, getByRole } = setup(load);
		await show();
		await fireEvent.click(getByRole('radio', { name: 'YAML' }));
		await vi.waitFor(() => expect(document.body.querySelector('pre')?.textContent).toBe('name: Orders sync\n'));
		expect(document.body.querySelector('a[download]')?.getAttribute('download')).toBe('orders_sync.yaml');
		const close = [...(dialog() as HTMLElement).querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Close') as HTMLElement;
		await fireEvent.click(close);
		expect(dialog()).toBeNull();
		await show();
		expect(load).toHaveBeenLastCalledWith('yaml');
	});

	it('says the export could not be loaded, stops saying it is loading, and offers no download', async () => {
		const { show } = setup(async () => {
			throw new Error('down');
		});
		await show();
		await vi.waitFor(() => expect(dialog()?.textContent).toContain('The export could not be loaded. Save the draft and try again.'));
		expect(dialog()?.textContent).not.toContain('Loading the export.');
		expect(document.body.querySelector('pre')).toBeNull();
		expect(document.body.querySelector('a[download]')).toBeNull();
	});
});
