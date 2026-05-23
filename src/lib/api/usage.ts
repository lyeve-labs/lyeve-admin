/**
 * The usage plugin's admin routes.
 *
 * Three things, and the distinctions matter. A quota is the limit set for one
 * tenant. Usage is what that tenant has actually consumed this period. A quota
 * request is a tenant asking for more, which somebody has to approve or deny.
 *
 * The setting that decides whether a quota does anything is `is_hard_limit`
 * together with `block_on_exceeded`. A soft quota is a reporting line: the
 * tenant goes past it and nothing stops. That is a legitimate choice and it is
 * also what you get by leaving the boxes unticked, so a screen that shows the
 * numbers without saying which kind they are is describing enforcement that
 * may not exist.
 *
 * A limit of zero leaves that dimension unchecked entirely. It reads like the
 * strictest possible setting and it is the loosest.
 */
import type { HttpClient } from '@lyeve-labs/client';
import { GATE_OK, gateOf, type Gate } from './gate';
import type { ListEnvelope } from './list';
import { formatCount } from '$lib/format';

export const QUOTAS_URL = '/api/admin/quotas';
export const REQUESTS_URL = '/api/admin/quota-requests';
export const TENANTS_URL = '/api/admin/usage/tenants';

export interface Quota {
	id: string;
	tenant_id: string;
	requests_limit: number;
	storage_bytes_limit: number;
	bandwidth_bytes_limit: number;
	is_hard_limit: boolean;
	grace_period_hours: number;
	warn_at_pct_80: boolean;
	warn_at_pct_90: boolean;
	block_on_exceeded: boolean;
	blocked_at?: string | null;
	created_at: string;
	updated_at: string;
}

export interface QuotaRequest {
	id: string;
	tenant_id: string;
	requested_by: string;
	requests_limit?: number | null;
	storage_bytes_limit?: number | null;
	bandwidth_bytes_limit?: number | null;
	reason: string;
	status: string;
	reviewed_by: string;
	reviewed_at?: string | null;
	created_at: string;
}

export interface TenantUsage {
	tenant_id: string;
	billing_period: string;
	api_calls: number;
	storage_bytes: number;
	bandwidth_bytes: number;
	content_count: number;
	media_count: number;
}

export type UsageGate = Gate;

export const USAGE_OK: UsageGate = GATE_OK;

/** What a refused usage read means, read the way every plugin's is. */
export function usageGate(err: unknown): UsageGate {
	return gateOf(err, 'Usage could not be read. This is not a report that nobody is over their limit.');
}

export async function listQuotas(
	client: HttpClient,
	limit = 50,
	offset = 0
): Promise<ListEnvelope<Quota>> {
	return client.get<ListEnvelope<Quota>>(`${QUOTAS_URL}?limit=${limit}&offset=${offset}`);
}

export async function listRequests(client: HttpClient): Promise<ListEnvelope<QuotaRequest>> {
	return client.get<ListEnvelope<QuotaRequest>>(REQUESTS_URL);
}

export async function listTenantUsage(client: HttpClient): Promise<ListEnvelope<TenantUsage>> {
	return client.get<ListEnvelope<TenantUsage>>(TENANTS_URL);
}

export async function reviewRequest(
	client: HttpClient,
	id: string,
	approve: boolean,
	note: string
): Promise<void> {
	await client.post(`${REQUESTS_URL}/${encodeURIComponent(id)}/review`, {
		status: approve ? 'approved' : 'denied',
		reason: note,
	});
}

/** The body of a quota write. Every field is sent, so the form is the whole setting. */
export interface QuotaInput {
	requests_limit: number;
	storage_bytes_limit: number;
	bandwidth_bytes_limit: number;
	is_hard_limit: boolean;
	grace_period_hours: number;
	warn_at_pct_80: boolean;
	warn_at_pct_90: boolean;
	block_on_exceeded: boolean;
}

/**
 * Set a tenant's quota. The engine may refuse a write with 402. The page
 * renders the refusal it sends.
 */
export async function upsertQuota(client: HttpClient, tenantId: string, body: QuotaInput): Promise<Quota> {
	return client.put<Quota>(`${QUOTAS_URL}/${encodeURIComponent(tenantId)}`, body);
}

/** Remove a tenant's quota, which leaves it unlimited. */
export async function deleteQuota(client: HttpClient, tenantId: string): Promise<void> {
	await client.delete(`${QUOTAS_URL}/${encodeURIComponent(tenantId)}`);
}

const GIB = 1024 ** 3;

/** Whole gigabytes, the unit the editor speaks, to the bytes the engine stores. */
export function gibToBytes(gib: number): number {
	return Number.isFinite(gib) && gib > 0 ? Math.round(gib * GIB) : 0;
}

export function bytesToGib(b: number): number {
	return b > 0 ? Math.round((b / GIB) * 100) / 100 : 0;
}

/** The quota a form names. A field that is not a non-negative number reads as 0. */
export function quotaFrom(form: FormData): QuotaInput {
	const n = (key: string) => {
		const v = Number(String(form.get(key) ?? '').trim());
		return Number.isFinite(v) && v > 0 ? v : 0;
	};
	const on = (key: string) => form.get(key) === 'true';
	return {
		requests_limit: Math.round(n('requests_limit')),
		storage_bytes_limit: gibToBytes(n('storage_gib')),
		bandwidth_bytes_limit: gibToBytes(n('bandwidth_gib')),
		is_hard_limit: on('is_hard_limit'),
		grace_period_hours: Math.round(n('grace_period_hours')),
		warn_at_pct_80: on('warn_at_pct_80'),
		warn_at_pct_90: on('warn_at_pct_90'),
		block_on_exceeded: on('block_on_exceeded'),
	};
}

/** Requests still waiting on somebody. */
export function pending(requests: readonly QuotaRequest[]): QuotaRequest[] {
	return requests.filter((r) => r.status === 'pending');
}

/**
 * Whether a quota actually stops anything.
 *
 * A soft quota is a reporting line: the tenant passes it and nothing happens.
 * That is a real choice and it is also the default you get by leaving the
 * boxes unticked, so showing the numbers without saying which kind they are
 * describes enforcement that may not exist.
 */
export function enforces(q: Quota): boolean {
	return q.is_hard_limit && q.block_on_exceeded;
}

export function enforcementLabel(q: Quota): string {
	if (!hasAnyLimit(q)) return 'No limit set';
	if (enforces(q)) return 'Blocks when exceeded';
	if (q.is_hard_limit) return 'Hard limit, but does not block';
	return 'Reported only, never blocks';
}

export function enforcementTone(q: Quota): 'success' | 'warn' | 'neutral' {
	if (!hasAnyLimit(q)) return 'neutral';
	return enforces(q) ? 'success' : 'warn';
}

/**
 * Whether any dimension is actually capped.
 *
 * Zero means unchecked, which reads like the strictest possible setting and
 * is the loosest. A quota with three zeros limits nothing at all.
 */
export function hasAnyLimit(q: Quota): boolean {
	return q.requests_limit > 0 || q.storage_bytes_limit > 0 || q.bandwidth_bytes_limit > 0;
}

/** Dimensions left unchecked on a quota that caps at least one other. */
export function uncheckedDimensions(q: Quota): string[] {
	if (!hasAnyLimit(q)) return [];
	const out: string[] = [];
	if (q.requests_limit <= 0) out.push('API calls');
	if (q.storage_bytes_limit <= 0) out.push('storage');
	if (q.bandwidth_bytes_limit <= 0) out.push('bandwidth');
	return out;
}

/** Tenants the engine has actually stopped. */
export function blocked(quotas: readonly Quota[]): Quota[] {
	return quotas.filter((q) => !!q.blocked_at);
}

/**
 * How much of a limit is used, as a percentage, or null when unchecked.
 *
 * Null rather than zero: an unchecked dimension is not a tenant using none of
 * its allowance, and drawing it at 0% puts it beside genuinely quiet tenants.
 */
export function usedPct(used: number, limit: number): number | null {
	if (limit <= 0) return null;
	return Math.round((used / limit) * 1000) / 10;
}

export function usageTone(pct: number | null): 'danger' | 'warn' | 'success' | 'neutral' {
	if (pct === null) return 'neutral';
	if (pct >= 100) return 'danger';
	if (pct >= 80) return 'warn';
	return 'success';
}

/** A byte count a person can read. */
export function bytes(size: number | null | undefined): string {
	if (size === null || size === undefined || !Number.isFinite(size) || size <= 0) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	let n = size;
	let i = 0;
	while (n >= 1024 && i < units.length - 1) {
		n /= 1024;
		i += 1;
	}
	return `${i === 0 ? n : n.toFixed(1)} ${units[i]}`;
}

/** A limit as written, with zero spelled out rather than shown as a number. */
export function limitLabel(limit: number, asBytes = false): string {
	if (limit <= 0) return 'Unchecked';
	return asBytes ? bytes(limit) : formatCount(limit);
}
