import { describe, expect, it } from 'vitest';
import { draftIsLive, writeButtons } from './publish';

const at = '2026-09-26T10:00:00.123456Z';

describe('draftIsLive', () => {
	it('reads a flow stamped with its live version as published', () => {
		expect(draftIsLive({ status: 'active', version: 3, updated_at: at }, [{ version: 3, created_at: at }])).toBe(true);
	});

	it('reads a save after the publish as a draft ahead of what runs', () => {
		const later = '2026-09-26T10:05:00Z';
		expect(draftIsLive({ status: 'active', version: 3, updated_at: later }, [{ version: 3, created_at: at }])).toBe(false);
	});

	it('reads a draft, disabled or blocked flow as having something to publish', () => {
		for (const status of ['draft', 'disabled', 'blocked'] as const) {
			expect(draftIsLive({ status, version: 3, updated_at: at }, [{ version: 3, created_at: at }])).toBe(false);
		}
	});

	it('answers no when the live version is not in the list', () => {
		expect(draftIsLive({ status: 'active', version: 4, updated_at: at }, [{ version: 3, created_at: at }])).toBe(false);
	});
});

describe('writeButtons', () => {
	const base = { dirty: false, live: false, publishable: true, refusal: 'Fix the issues before publishing' };

	it('disables Save with nothing to save and makes it primary once there is', () => {
		expect(writeButtons(base).save).toMatchObject({ disabled: true, variant: 'primary' });
		expect(writeButtons({ ...base, dirty: true }).save).toMatchObject({ disabled: false, variant: 'primary' });
	});

	it('keeps one primary: Save while dirty, Publish once the draft is saved', () => {
		const dirty = writeButtons({ ...base, dirty: true });
		expect(dirty.publish).toMatchObject({ disabled: false, variant: 'secondary' });
		const saved = writeButtons(base);
		expect(saved.publish).toMatchObject({ disabled: false, variant: 'primary' });
	});

	it('disables Publish when the live version is the saved draft', () => {
		expect(writeButtons({ ...base, live: true }).publish).toMatchObject({ disabled: true, hint: 'The live version is this draft' });
		expect(writeButtons({ ...base, live: true, dirty: true }).publish.disabled).toBe(false);
	});

	it('disables Publish with the reason when the draft cannot be published', () => {
		expect(writeButtons({ ...base, publishable: false }).publish).toMatchObject({ disabled: true, hint: base.refusal });
	});
});
