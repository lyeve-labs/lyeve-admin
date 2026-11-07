import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { ApiError } from '@lyeve-labs/client';
import { authedClient } from '$lib/server/authz';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import { isOutage, section, type Gate, type Section } from '$lib/api/gate';
import { pageWindow } from '$lib/api/list';
import { listSchemaNames } from '$lib/api/search-settings';
import { applySchemaPreset } from '$lib/api/schema-preset-catalog';
import { getSettings, refusalCode, refusedField, saveSettings, type SettingsPatch } from '$lib/api/connected-editors';
import {
	CONTACT_PRESET,
	CONTACT_SCHEMA,
	deleteSubmission,
	hasSubmissions,
	isFormState,
	listForms,
	listSubmissions,
	setSubmissionState,
	type FormRef,
	type FormState,
	type PublishedForm,
	type SubmissionPage,
} from '$lib/api/builder-forms';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** The form whose submissions the page shows, from the address. */
interface Selected {
	ref: FormRef;
	/** The filter. 'all' lists every state. */
	state: FormState | 'all';
	limit: number;
	offset: number;
	form: PublishedForm | null;
	/** Null for a form that never saved into a content type. */
	submissions: Section<SubmissionPage> | null;
}

function selectedRef(url: URL): FormRef | null {
	const site = url.searchParams.get('site') ?? '';
	const path = url.searchParams.get('path') ?? '';
	const block = url.searchParams.get('block') ?? '';
	return site && path && block ? { site, path, block } : null;
}

export const load: PageServerLoad = async (event) => {
	// The triage forms invalidate only this, so the flows and settings in the
	// layout are not read again on every submit.
	event.depends('forms:submissions');
	const { plugins } = await event.parent();
	const ref = selectedRef(event.url);
	const stateParam = event.url.searchParams.get('state') ?? 'new';
	const state: FormState | 'all' = isFormState(stateParam) ? stateParam : 'all';
	const { limit, offset } = pageWindow(event.url, DEFAULT_LIMIT, MAX_LIMIT);

	if (notRunning(plugins, PLUGIN.builder)) {
		return { gate: { state: 'absent' } as Gate, forms: [] as PublishedForm[], selected: null as Selected | null };
	}

	const client = authedClient(event);
	const forms = await section(listForms(client), 'Could not load forms.');

	let selected: Selected | null = null;
	if (forms.ok && ref) {
		const form = forms.value.find((f) => f.site === ref.site && f.path === ref.path && f.block === ref.block) ?? null;
		const submissions =
			form && hasSubmissions(form)
				? await section(
						listSubmissions(client, ref, { state: state === 'all' ? undefined : state, limit, offset }),
						'Could not load submissions.',
					)
				: null;
		selected = { ref, state, limit, offset, form, submissions };
	}

	return { gate: forms.ok ? ({ state: 'ok' } as Gate) : forms.gate, forms: forms.ok ? forms.value : [], selected };
};

/** The engine's own sentence for a 4xx that carries its code, else the page's. */
function refusalSentence(err: unknown, fallback: string): string {
	if (err instanceof ApiError && err.status >= 400 && err.status < 500 && refusalCode(err) && err.message.trim()) {
		return err.message;
	}
	return fallback;
}

const CHECK_SAVED = 'Could not confirm the change. Reload the page to check it, then try again.';

export const actions: Actions = {
	targets: async (event) => {
		const form = await event.request.formData();
		const patch: SettingsPatch = {};
		// Only a list the form offered is saved, so a list that failed to load clears nothing.
		if (form.get('schemas_offered')) patch.form_schemas = form.getAll('form_schemas').map(String).filter(Boolean);
		if (form.get('flows_offered')) patch.form_flows = form.getAll('form_flows').map(String).filter(Boolean);
		if (Object.keys(patch).length === 0) {
			return fail(400, { targetsError: { field: '', message: 'This form is missing its settings. Reload the page and try again.' } });
		}
		try {
			await saveSettings(authedClient(event), patch);
			return { targetsSaved: true };
		} catch (e) {
			if (refusalCode(e) === 'settings_invalid') {
				return fail(422, { targetsError: { field: refusedField(e), message: (e as ApiError).message } });
			}
			if (isOutage(e)) return fail(503, { targetsError: { field: '', message: CHECK_SAVED } });
			return fail(e instanceof ApiError ? e.status : 400, {
				targetsError: { field: '', message: refusalSentence(e, 'Could not save where forms can send. Try again.') },
			});
		}
	},

	// Creates the contact content type from the schema plugin's preset, unless
	// it exists already, and lets forms send to it.
	setup: async (event) => {
		const client = authedClient(event);
		try {
			const [names, settings] = await Promise.all([listSchemaNames(client), getSettings(client)]);
			let created = false;
			if (!names.includes(CONTACT_SCHEMA)) {
				try {
					await applySchemaPreset(client, CONTACT_PRESET);
					created = true;
				} catch (e) {
					if (e instanceof ApiError && e.status === 404) return fail(404, { setupMissing: true });
					throw e;
				}
			}
			const allowed = settings.form_schemas ?? [];
			if (!allowed.includes(CONTACT_SCHEMA)) await saveSettings(client, { form_schemas: [...allowed, CONTACT_SCHEMA] });
			return { setupDone: { created } };
		} catch (e) {
			if (isOutage(e)) return fail(503, { setupError: CHECK_SAVED });
			return fail(e instanceof ApiError ? e.status : 400, {
				setupError: refusalSentence(e, 'Could not set up a content type for form posts. Try again.'),
			});
		}
	},

	state: async (event) => {
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		const state = form.get('state');
		if (!id || !isFormState(state)) {
			return fail(400, { entryError: 'This form is missing its submission. Reload the page and try again.' });
		}
		try {
			await setSubmissionState(authedClient(event), id, state);
			return { stateSet: state };
		} catch (e) {
			if (e instanceof ApiError && e.status === 404) return fail(404, { entryError: 'This submission no longer exists.' });
			if (isOutage(e)) return fail(503, { entryError: CHECK_SAVED });
			return fail(e instanceof ApiError ? e.status : 400, {
				entryError: refusalSentence(e, 'Could not change the submission. Try again.'),
			});
		}
	},

	delete: async (event) => {
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { entryError: 'This form is missing its submission. Reload the page and try again.' });
		try {
			await deleteSubmission(authedClient(event), id);
			return { deleted: true };
		} catch (e) {
			if (e instanceof ApiError && e.status === 404) return fail(404, { entryError: 'This submission no longer exists.' });
			if (isOutage(e)) return fail(503, { entryError: CHECK_SAVED });
			return fail(e instanceof ApiError ? e.status : 400, {
				entryError: refusalSentence(e, 'Could not delete the submission. Try again.'),
			});
		}
	},
};
