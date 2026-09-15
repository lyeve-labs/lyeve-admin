import { describe, expect, it } from 'vitest';
import { actions, load } from './+page.server';
import { fixtureSettings } from '$lib/components/ai/fixtures';
import { actionEvent, formOf, json, loadEvent, refused, sentBody } from '$lib/components/ai/test-events';

const path = '/admin/ai/settings';
type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;

describe('admin/ai/settings load', () => {
	it('reads the retention window from the instance configuration for a super admin', async () => {
		const { event } = loadEvent(
			{ '/api/admin/config': () => json({ settings: [{ key: 'ai_transcript_retention', source: 'admin', value: '168h', editable: true }] }) },
			{ path }
		);
		const out = (await load(event)) as Loaded;
		expect(out.instanceReadable).toBe(true);
		expect(out.instance).toEqual([
			{ key: 'ai_transcript_retention', value: '168h', source: 'admin', editable: true },
			{ key: 'ai_transcripts_enabled', value: 'true', source: 'default', editable: false },
		]);
	});

	it('shows the defaults, named as such, when the configuration cannot be read or the role cannot ask', async () => {
		const refusedRead = loadEvent({ '/api/admin/config': () => refused(500, 'boom') }, { path });
		const a = (await load(refusedRead.event)) as Loaded;
		expect(a.instanceReadable).toBe(false);
		expect(a.instance[0]).toEqual({ key: 'ai_transcript_retention', value: '720h', source: 'default', editable: false });

		const admin = loadEvent({ '/api/admin/config': () => json({ settings: [] }) }, { path, roles: ['admin'] });
		const b = (await load(admin.event)) as Loaded;
		expect(b.instanceReadable).toBe(false);
		expect(admin.calls.some((c) => c.url.includes('/api/admin/config'))).toBe(false);
	});
});

describe('admin/ai/settings actions', () => {
	it('sends only the switch the form named', async () => {
		const { event, calls } = actionEvent(
			{ '/api/admin/ai/settings': () => json({ ...fixtureSettings, transcripts_enabled: false }) },
			formOf({ transcripts_enabled: 'false' }),
			{ path, roles: ['admin'] }
		);
		const out = await actions.save(event);
		expect(out).toMatchObject({ scope: 'switch', settings: { transcripts_enabled: false } });
		expect(sentBody(calls, '/api/admin/ai/settings')).toEqual({ transcripts_enabled: false });
	});

	it('turns the tenant switch on from the off panel', async () => {
		const { event, calls } = actionEvent({ '/api/admin/ai/settings': () => json(fixtureSettings) }, formOf({ enabled: 'true' }), { path });
		await actions.save(event);
		expect(sentBody(calls, '/api/admin/ai/settings')).toEqual({ enabled: true });
	});

	it('names the license on a 402 and the role on a 403', async () => {
		const locked = actionEvent({ '/api/admin/ai/settings': () => refused(402, 'x') }, formOf({ enabled: 'false' }), { path });
		expect(await actions.save(locked.event)).toMatchObject({ status: 400, data: { error: 'AI is not enabled on this instance.' } });
		const forbidden = actionEvent({ '/api/admin/ai/settings': () => refused(403, 'forbidden') }, formOf({ enabled: 'false' }), { path });
		expect(await actions.save(forbidden.event)).toMatchObject({ status: 400, data: { error: 'forbidden' } });
	});

	it('writes the retention window through the configuration route and refuses a bad duration', async () => {
		const ok = actionEvent({ '/api/admin/config': () => json({ saved: [] }) }, formOf({ key: 'ai_transcript_retention', value: '168h' }), { path });
		expect(await actions.config(ok.event)).toEqual({ scope: 'config', key: 'ai_transcript_retention', success: true });
		expect(sentBody(ok.calls, '/api/admin/config')).toEqual({ values: { ai_transcript_retention: '168h' } });

		const bad = actionEvent({}, formOf({ key: 'ai_transcript_retention', value: 'a week' }), { path });
		expect(await actions.config(bad.event)).toMatchObject({ status: 400, data: { error: expect.stringContaining('720h') } });

		const other = actionEvent({}, formOf({ key: 'jwt_secret', value: 'x' }), { path });
		expect(await actions.config(other.event)).toMatchObject({ status: 400 });
	});

	it('relays a refusal from the configuration route with where the value is set', async () => {
		const { event } = actionEvent(
			{ '/api/admin/config': () => json({ refused: [{ key: 'ai_transcript_retention', reason: 'set by the environment', origin: 'AI_TRANSCRIPT_RETENTION' }] }) },
			formOf({ key: 'ai_transcript_retention', value: '48h' }),
			{ path }
		);
		expect(await actions.config(event)).toMatchObject({ status: 409, data: { error: 'set by the environment (AI_TRANSCRIPT_RETENTION)' } });
	});
});
