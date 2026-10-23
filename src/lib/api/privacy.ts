/**
 * A tenant's privacy settings: what an erasure does with the tenant's form
 * submissions.
 *
 * Each setting belongs to the plugin that serves its routes, and a page shows
 * one only while those routes answer. An engine older than a setting answers
 * 404 on its routes, and the page then leaves the setting out rather than
 * offering a control that cannot save. A session that names no tenant is
 * answered 400, because every setting here is one tenant's.
 */
import { isHttpError, isRedirect } from '@sveltejs/kit';
import { ApiError, type HttpClient } from '@lyeve-labs/client';
import { gateOf, type Section } from './gate';
import type { NotRunningReason } from '$lib/plugins';

export const FORM_ERASURE_URL = '/api/admin/schemas/form-erasure';

export const FORM_ERASURE_MODES = ['auto', 'soft', 'hard'] as const;
export type FormErasureMode = (typeof FORM_ERASURE_MODES)[number];

export interface FormErasure {
	mode: FormErasureMode;
}

/** What the page says, once, when the session names no tenant. */
export const NO_TENANT =
	'These settings belong to a tenant, and this session is signed in to none. Sign in to a tenant to read or change them.';

/**
 * A setting as load data. Null while its route is not there, on an engine
 * that predates it, and the page leaves it out. Stopped while the engine says
 * the plugin serving it does not run, with the reason the shell would give.
 * Otherwise the value it read, or the gate that says why there is none.
 */
export type Setting<T> = Section<T> | { ok: false; stopped: NotRunningReason } | null;

/** A read the engine refused because the session names no tenant. */
export const NO_TENANT_READ = { ok: false, noTenant: true } as const;

/** What one read answers, before the page knows whether the session names a tenant. */
export type SettingRead<T> = Setting<T> | typeof NO_TENANT_READ;

/**
 * Await a setting's read. A 404 hides the setting, a 400 says the session
 * names no tenant, and any other failure is kept as a gate.
 */
export async function setting<T>(read: Promise<T>, failed: string): Promise<SettingRead<T>> {
	try {
		return { ok: true, value: await read };
	} catch (err) {
		if (isRedirect(err) || isHttpError(err)) throw err;
		if (err instanceof ApiError && err.status === 404) return null;
		if (err instanceof ApiError && err.status === 400) return NO_TENANT_READ;
		return { ok: false, gate: gateOf(err, failed) };
	}
}

/** Whether a read was refused because the session names no tenant. */
export function namesNoTenant(read: SettingRead<unknown>): read is typeof NO_TENANT_READ {
	return read !== null && 'noTenant' in read;
}

export function isFormErasureMode(v: string): v is FormErasureMode {
	return (FORM_ERASURE_MODES as readonly string[]).includes(v);
}

export async function readFormErasure(client: HttpClient): Promise<FormErasure> {
	return client.get<FormErasure>(FORM_ERASURE_URL);
}

export async function saveFormErasure(client: HttpClient, mode: FormErasureMode): Promise<FormErasure> {
	return client.put<FormErasure>(FORM_ERASURE_URL, { mode });
}
