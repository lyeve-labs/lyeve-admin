/**
 * The builder plugin's form routes: the forms on published pages, what
 * visitors sent through them, and the flows a form may start.
 *
 * A form sends to one content type or one flow. Its submissions are entries
 * of that content type, so a form that starts a flow has none here: what it
 * sent lives in the flow's runs.
 */
import type { HttpClient } from '@lyeve-labs/client';
import { getFlow, listFlows } from '$lib/api/flows';
import type { FlowDefinition, FlowStatus } from '$lib/flow/types';

export const FORMS_URL = '/api/admin/builder/forms';

/** The system event a flow subscribes to so that a form can start it. */
export const FORM_EVENT = 'builder.form.submitted';

/** The schema preset that creates a content type for contact form posts, and the type it creates. */
export const CONTACT_PRESET = 'contact';
export const CONTACT_SCHEMA = 'contact_messages';

export const FORM_STATES = ['new', 'read', 'spam'] as const;
export type FormState = (typeof FORM_STATES)[number];

export function isFormState(v: unknown): v is FormState {
	return typeof v === 'string' && (FORM_STATES as readonly string[]).includes(v);
}

/** Where a form sends: exactly one of the two keys. */
export interface FormDestination {
	schema?: string;
	flow?: string;
}

/** One form on a published page, as the list sends it. */
export interface PublishedForm {
	/** The site's id. */
	site: string;
	/** The site's name. Empty when the site no longer exists. */
	site_name: string;
	path: string;
	/** The form block's id on the page. */
	block: string;
	label: string;
	/** Null for a form that names no destination. */
	destination: FormDestination | null;
	counts: Record<FormState, number>;
}

/** The three keys that name one form. */
export type FormRef = Pick<PublishedForm, 'site' | 'path' | 'block'>;

/** One entry a form wrote. The id is the content entry's. */
export interface FormSubmission {
	id: string;
	schema: string;
	state: FormState;
	created_at: string;
	fields: Record<string, unknown>;
}

export interface SubmissionPage {
	data: FormSubmission[];
	total: number;
	limit: number;
	offset: number;
}

function formQuery(ref: FormRef, extra: Record<string, string | number | undefined> = {}): string {
	const qs = new URLSearchParams({ site: ref.site, path: ref.path, block: ref.block });
	for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== '') qs.set(k, String(v));
	return qs.toString();
}

export async function listForms(client: HttpClient): Promise<PublishedForm[]> {
	const res = await client.get<{ data?: PublishedForm[] } | null>(FORMS_URL);
	return (Array.isArray(res?.data) ? res.data : []).map((f) => ({
		...f,
		site_name: f.site_name ?? '',
		destination: f.destination ?? null,
		counts: { new: f.counts?.new ?? 0, read: f.counts?.read ?? 0, spam: f.counts?.spam ?? 0 },
	}));
}

/** One page of a form's submissions, newest first. No state lists every state. */
export function listSubmissions(
	client: HttpClient,
	ref: FormRef,
	params: { state?: FormState; limit: number; offset: number },
): Promise<SubmissionPage> {
	return client.get<SubmissionPage>(`${FORMS_URL}/submissions?${formQuery(ref, params)}`);
}

export function setSubmissionState(client: HttpClient, id: string, state: FormState): Promise<{ id: string; state: FormState }> {
	return client.patch(`${FORMS_URL}/submissions/${encodeURIComponent(id)}`, { state });
}

/** Deletes the entry from its content type as well. */
export function deleteSubmission(client: HttpClient, id: string): Promise<void> {
	return client.delete<void>(`${FORMS_URL}/submissions/${encodeURIComponent(id)}`);
}

/** The engine's CSV of one form. */
export function exportPath(ref: FormRef): string {
	return `${FORMS_URL}/submissions/export?${formQuery(ref)}`;
}

/** A content type a form may be allowed to send to. */
export interface SchemaOption {
	name: string;
	label: string;
	/** Served by the delivery API, so anyone could read a post saved there. Forms cannot send to it. */
	delivered: boolean;
}

/** A flow as the form screens need it: whether a form can start it and whether it runs. */
export interface FlowTarget {
	id: string;
	slug: string;
	name: string;
	status: FlowStatus;
	/** The flow's trigger is the builder form event. */
	formTrigger: boolean;
}

/** The engine caps a page of flows at this many rows. */
const FLOW_PAGE = 200;

/** Whether a trigger is the system event a form publishes. */
function startsFromForm(def: FlowDefinition | undefined): boolean {
	const t = def?.trigger;
	return t?.type === 'trigger.event' && t.config?.kind === 'system' && t.config?.name === FORM_EVENT;
}

/**
 * Every flow of the tenant, up to `cap`, each marked with whether a form can
 * start it. The list carries only the trigger's type, so each flow on an
 * event trigger is read once more: its published version when it has one,
 * else its draft.
 */
export async function readFlowTargets(client: HttpClient, cap = 1000): Promise<FlowTarget[]> {
	const rows = [];
	for (let offset = 0; offset < cap; offset += FLOW_PAGE) {
		const page = await listFlows(client, { limit: FLOW_PAGE, offset });
		rows.push(...page.rows);
		if (page.rows.length < FLOW_PAGE) break;
	}
	return Promise.all(
		rows.slice(0, cap).map(async (f) => {
			let formTrigger = false;
			if (f.trigger_type === 'trigger.event') {
				const def =
					f.version > 0
						? (await client.get<{ definition?: FlowDefinition }>(`/api/admin/flows/${encodeURIComponent(f.id)}/versions/${f.version}`)).definition
						: (await getFlow(client, f.id)).draft;
				formTrigger = startsFromForm(def);
			}
			return { id: f.id, slug: f.slug, name: f.name || f.slug, status: f.status, formTrigger };
		}),
	);
}

/** Why a form sending to `slug` starts nothing, or null when it starts the flow. */
export type FlowProblem = 'missing' | 'trigger' | 'inactive';

export function flowProblem(slug: string, flows: readonly FlowTarget[]): FlowProblem | null {
	const f = flows.find((x) => x.slug === slug);
	if (!f) return 'missing';
	if (!f.formTrigger) return 'trigger';
	if (f.status !== 'active') return 'inactive';
	return null;
}

/** What the list of forms says beside a form whose flow starts nothing. */
export function formWarning(problem: FlowProblem, name: string): string {
	switch (problem) {
		case 'missing':
			return `The flow ${name} no longer exists, so posts to this form start nothing.`;
		case 'trigger':
			return `The flow ${name} does not start from a builder form, so posts to this form start nothing.`;
		case 'inactive':
			return `The flow ${name} is not active, so posts to this form start nothing. Publish the flow to turn it on.`;
	}
}

/** What the settings say beside an allowed flow that a form cannot start. */
export const FLOW_NOTE: Record<FlowProblem, string> = {
	missing: 'No flow uses this slug any more. Clear it, then save.',
	trigger: 'This flow does not start from a builder form, so forms cannot start it.',
	inactive: 'This flow is not active, so forms that send to it start nothing.',
};
