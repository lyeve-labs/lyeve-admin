import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionError } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import {
	PII_OK,
	createRule,
	deleteRule,
	getRules,
	listAccessLog,
	piiGate,
	testRule,
	updateRule,
	type AccessEntry,
	type PiiGate,
	type RuleCatalog,
} from '$lib/api/pii-mask';
import { pageWindow } from '$lib/api/list';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 199;

export const load: PageServerLoad = async (event) => {
	const { plugins } = await event.parent();
	const { limit, offset } = pageWindow(event.url, DEFAULT_LIMIT, MAX_LIMIT);

	// The shell says why the page is unavailable while its plugin does not run.
	if (notRunning(plugins, PLUGIN.piiMask)) {
		return {
			rules: null as RuleCatalog | null,
			entries: [] as AccessEntry[],
			total: 0,
			limit,
			offset,
			gate: { state: 'absent' } as PiiGate,
		};
	}

	const client = authedClient(event);
	let rules: RuleCatalog | null = null;
	let gate: PiiGate = PII_OK;
	try {
		rules = await getRules(client);
	} catch (err) {
		gate = piiGate(err);
	}

	// The access log is the second read. Losing it must not hide the rules,
	// which are the answer to "is anything being masked at all".
	let entries: AccessEntry[] = [];
	let total = 0;
	let logFailed = false;
	if (gate.state === 'ok') {
		try {
			const page = await listAccessLog(client, limit, offset);
			entries = page.data ?? [];
			total = Math.max(page.total_count ?? 0, offset + entries.length);
		} catch {
			logFailed = true;
		}
	}

	return { rules, entries, total, limit, offset, gate, logFailed };
};

/** One rule out of a submitted form, with the numbers already numbers. */
function draftFrom(form: FormData) {
	return {
		name: String(form.get('name') ?? '').trim(),
		description: String(form.get('description') ?? '').trim(),
		pattern: String(form.get('pattern') ?? '').trim(),
		replacement: String(form.get('replacement') ?? '').trim(),
		// An empty priority is not zero. Zero would run the rule before every
		// preset, which is the opposite of what leaving a field blank means.
		priority: Number(form.get('priority')) || 100,
		enabled: form.get('enabled') === 'on' || form.get('enabled') === 'true',
	};
}

export const actions: Actions = {
	create: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const form = await event.request.formData();
		try {
			await createRule(authedClient(event), draftFrom(form));
			return { saved: true };
		} catch (err) {
			return fail(422, actionError(err, 'Could not save the rule.'));
		}
	},

	update: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { error: 'Which rule?' });
		try {
			await updateRule(authedClient(event), id, draftFrom(form));
			return { saved: true };
		} catch (err) {
			return fail(422, actionError(err, 'Could not save the rule.'));
		}
	},

	delete: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { error: 'Which rule?' });
		try {
			await deleteRule(authedClient(event), id);
			return { deleted: true };
		} catch (err) {
			return fail(422, actionError(err, 'Could not delete the rule.'));
		}
	},

	// The dry run. It stores nothing, so it is safe to press repeatedly while
	// a pattern is being worked out, which is the whole point of it.
	test: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const form = await event.request.formData();
		try {
			const result = await testRule(
				authedClient(event),
				String(form.get('pattern') ?? ''),
				String(form.get('replacement') ?? ''),
				String(form.get('sample') ?? ''),
			);
			return { test: result };
		} catch (err) {
			return fail(422, actionError(err, 'Could not run the pattern.'));
		}
	},
};
