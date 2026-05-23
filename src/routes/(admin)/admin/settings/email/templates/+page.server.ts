import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { ApiError } from '@lyeve-labs/client';
import { authedClient, requireUser } from '$lib/server/authz';
import { actionFailure } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import {
	SAMPLE_VARS,
	TEMPLATE_KEY,
	createTemplate,
	deleteTemplate,
	listTemplates,
	previewTemplate,
	templateLimits,
	templateStarters,
	updateTemplate,
	type EmailTemplate,
	type TemplateLimits,
	type TemplateStarter,
	type TemplateStatus,
} from '$lib/api/email-templates';

const STATUSES: TemplateStatus[] = ['draft', 'active', 'archived'];

export const load: PageServerLoad = async (event) => {
	await requireUser(event);
	const { plugins } = await event.parent();
	const none = { templates: [] as EmailTemplate[], starters: [] as TemplateStarter[], limits: null as TemplateLimits | null };
	// The shell says why the page is unavailable while its plugin does not run.
	if (notRunning(plugins, PLUGIN.email)) return { ...none, loadError: null as string | null };
	const client = authedClient(event);
	try {
		// The list first: it creates the required templates a new tenant does
		// not hold yet, and the count after it includes them.
		const templates = await listTemplates(client);
		const [starters, limits] = await Promise.all([
			templateStarters(client).catch((): TemplateStarter[] => []),
			templateLimits(client).catch((): TemplateLimits | null => null),
		]);
		return { templates, starters, limits, loadError: null as string | null };
	} catch {
		return { ...none, loadError: 'The templates could not be loaded.' };
	}
};

const text = (data: FormData, key: string): string => String(data.get(key) ?? '').trim();

function status(data: FormData): TemplateStatus {
	const s = text(data, 'status') as TemplateStatus;
	return STATUSES.includes(s) ? s : 'active';
}

export const actions: Actions = {
	save: async (event) => {
		await requireUser(event);
		const data = await event.request.formData();
		const id = text(data, 'id');
		const subject = text(data, 'subject');
		// The body is the author's to the byte, so it is not trimmed.
		const body = String(data.get('mjml_source') ?? '');
		if (!subject) return fail(400, { error: 'Enter a subject.' });
		const client = authedClient(event);
		try {
			if (id) {
				await updateTemplate(client, id, { subject, mjml_source: body, status: status(data) });
				return { saved: id };
			}
			const key = text(data, 'key');
			if (!TEMPLATE_KEY.test(key)) {
				return fail(400, { error: 'A name is lower case letters, digits and dashes, and starts with a letter.' });
			}
			const created = await createTemplate(client, { key, subject, mjml_source: body, status: status(data) });
			return { saved: created.id };
		} catch (err) {
			// 409 on a create is a name the tenant already holds. The plugin's
			// sentence for a refused body (422) is written for the author.
			if (err instanceof ApiError && err.status === 409) return fail(409, { error: 'A template with that name already exists.' });
			return actionFailure(err, 'The template could not be saved.', err instanceof ApiError && err.status === 422 ? 422 : 400);
		}
	},

	delete: async (event) => {
		await requireUser(event);
		const id = text(await event.request.formData(), 'id');
		if (!id) return fail(400, { error: 'Choose a template.' });
		try {
			await deleteTemplate(authedClient(event), id);
			return { deleted: id };
		} catch (err) {
			return actionFailure(err, 'The template could not be deleted.', err instanceof ApiError && err.status === 409 ? 409 : 400);
		}
	},

	preview: async (event) => {
		await requireUser(event);
		const key = text(await event.request.formData(), 'key');
		if (!key) return fail(400, { error: 'Choose a template.' });
		try {
			const out = await previewTemplate(authedClient(event), key, SAMPLE_VARS);
			return { preview: { key, subject: out.subject, html: out.html } };
		} catch (err) {
			return actionFailure(err, 'The template could not be rendered. Check the body for an unclosed tag or a misspelled variable.');
		}
	},
};
