/**
 * The audit plugin's retention routes. They answer 402 on an instance not
 * enabled for them, which the shared gate reads like any other refusal.
 *
 * Two controls that work against each other, on purpose. A retention policy
 * deletes audit entries once they pass an age. A legal hold stops matching
 * entries being deleted even when their retention has expired. The hold wins,
 * and that is the whole point of it.
 *
 * So the dangerous reading on this screen is a policy shown alone. A policy
 * that says ninety days does not mean entries are gone after ninety days if a
 * hold covers them, and an auditor asking "is this deleted" needs both halves
 * to get an answer.
 *
 * Enforcement is the destructive control. It deletes, it is not a dry run, and
 * nothing undoes it.
 */
import type { HttpClient } from '@lyeve-labs/client';
import { GATE_OK, gateOf, type Gate } from './gate';
import type { ListEnvelope } from './list';

export const POLICIES_URL = '/api/admin/retention-policies';
export const HOLDS_URL = '/api/admin/legal-holds';
export const ENFORCE_URL = '/api/admin/retention/enforce';
export const EXPORT_URL = '/api/admin/retention/compliance-export';

export interface RetentionPolicy {
	id: string;
	/** Empty means this is the catch-all for every event type. */
	event_type: string;
	/** Empty means every resource type. */
	resource_type: string;
	retention_days: number;
	archival_enabled: boolean;
	archival_storage: string;
	archival_path_prefix: string;
	tenant_id: string;
	created_at: string;
	updated_at: string;
}

export interface LegalHold {
	id: string;
	name: string;
	description: string;
	filter_action: string;
	filter_resource_type: string;
	filter_resource_id: string;
	filter_actor?: string | null;
	filter_from?: string | null;
	filter_to?: string | null;
	filter_tenant_id: string;
	tenant_id: string;
	created_at: string;
	created_by: string;
	/** Soft delete. A released hold stops protecting anything. */
	deleted_at?: string | null;
}

export type RetentionGate = Gate;

export const RETENTION_OK: RetentionGate = GATE_OK;

/** What a refused retention read means, read the way every plugin's is. */
export function retentionGate(err: unknown): RetentionGate {
	return gateOf(err, 'The retention rules could not be read. This is not a report that nothing is being deleted.');
}

export async function listPolicies(client: HttpClient): Promise<ListEnvelope<RetentionPolicy>> {
	return client.get<ListEnvelope<RetentionPolicy>>(POLICIES_URL);
}

export async function listHolds(client: HttpClient): Promise<ListEnvelope<LegalHold>> {
	return client.get<ListEnvelope<LegalHold>>(HOLDS_URL);
}

export interface SavePolicy {
	event_type?: string;
	resource_type?: string;
	retention_days: number;
	archival_enabled?: boolean;
	archival_storage?: string;
	archival_path_prefix?: string;
}

export async function createPolicy(
	client: HttpClient,
	body: SavePolicy
): Promise<RetentionPolicy> {
	return client.post<RetentionPolicy>(POLICIES_URL, body);
}

export async function deletePolicy(client: HttpClient, id: string): Promise<void> {
	await client.delete(`${POLICIES_URL}/${encodeURIComponent(id)}`);
}

export interface SaveHold {
	name: string;
	description?: string;
	filter_action?: string;
	filter_resource_type?: string;
	filter_resource_id?: string;
	filter_tenant_id?: string;
}

export async function createHold(client: HttpClient, body: SaveHold): Promise<LegalHold> {
	return client.post<LegalHold>(HOLDS_URL, body);
}

export async function releaseHold(client: HttpClient, id: string): Promise<void> {
	await client.delete(`${HOLDS_URL}/${encodeURIComponent(id)}`);
}

export async function enforceNow(client: HttpClient): Promise<{ deleted?: number }> {
	return client.post<{ deleted?: number }>(ENFORCE_URL, {});
}

/** Holds still in force. A soft-deleted hold protects nothing. */
export function activeHolds(holds: readonly LegalHold[]): LegalHold[] {
	return holds.filter((h) => !h.deleted_at);
}

/**
 * What a policy covers, in words.
 *
 * An empty event type is the catch-all, which is the most consequential value
 * on the row: it deletes everything nothing else claims. Printing an empty
 * cell reads as an unfinished row rather than as the widest rule there is.
 */
export function policyScope(p: RetentionPolicy): string {
	const event = p.event_type || 'Every event';
	const resource = p.resource_type ? ` on ${p.resource_type}` : '';
	return `${event}${resource}`;
}

export function policyIsCatchAll(p: RetentionPolicy): boolean {
	return !p.event_type && !p.resource_type;
}

/**
 * What a hold covers, in words.
 *
 * A hold with no filters at all covers every audit entry there is, which
 * stops every retention policy from deleting anything. It is a legitimate
 * thing to want during litigation and a very easy thing to leave on.
 */
export function holdScope(h: LegalHold): string {
	const parts: string[] = [];
	if (h.filter_action) parts.push(h.filter_action);
	if (h.filter_resource_type) parts.push(`on ${h.filter_resource_type}`);
	if (h.filter_resource_id) parts.push(`id ${h.filter_resource_id}`);
	if (h.filter_tenant_id) parts.push(`tenant ${h.filter_tenant_id}`);
	return parts.length > 0 ? parts.join(', ') : 'Every audit entry';
}

export function holdIsUnbounded(h: LegalHold): boolean {
	return (
		!h.filter_action && !h.filter_resource_type && !h.filter_resource_id && !h.filter_tenant_id
	);
}

/**
 * Whether deletion is actually happening.
 *
 * A policy alone does not mean entries are being removed: an unbounded hold
 * overrides every one of them. An auditor asking "is this deleted after
 * ninety days" gets a wrong answer from the policy list alone.
 */
export function deletionIsBlocked(
	policies: readonly RetentionPolicy[],
	holds: readonly LegalHold[]
): boolean {
	return policies.length > 0 && activeHolds(holds).some(holdIsUnbounded);
}

/**
 * A retention window in the units people write policies in.
 *
 * Zero means keep nothing, which deletes on the next enforcement run. It is
 * worth spelling out rather than printing "0 days".
 */
export function retentionLabel(days: number): string {
	if (!Number.isFinite(days) || days < 0) return 'Not set';
	if (days === 0) return 'Delete at the next run';
	if (days % 365 === 0) {
		const years = days / 365;
		return `${years} ${years === 1 ? 'year' : 'years'}`;
	}
	if (days % 30 === 0) {
		const months = days / 30;
		return `${months} ${months === 1 ? 'month' : 'months'}`;
	}
	return `${days} ${days === 1 ? 'day' : 'days'}`;
}

/**
 * Whether a policy archives before deleting.
 *
 * Archival off means the entries are gone. With a compliance obligation that
 * is the difference between a retention policy and a data loss incident, so
 * it is stated rather than shown as an unticked box.
 */
export function archivalLabel(p: RetentionPolicy): string {
	if (!p.archival_enabled) return 'Deleted outright';
	return p.archival_storage ? `Archived to ${p.archival_storage}` : 'Archived';
}

export function archivalTone(p: RetentionPolicy): 'success' | 'warn' {
	return p.archival_enabled ? 'success' : 'warn';
}
