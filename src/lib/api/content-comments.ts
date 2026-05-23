/**
 * Editorial comment threads on a content entry. A thread is a first comment
 * with its replies, and only the first comment resolves or reopens it.
 *
 * The engine may refuse a write with 402. The page renders the refusal it
 * sends.
 */
import type { HttpClient } from '@lyeve-labs/client';

export interface EntryComment {
	id: string;
	entry_id: string;
	parent_id?: string;
	author_id: string;
	body: string;
	mentions: string[];
	resolved: boolean;
	resolved_by?: string;
	resolved_at?: string;
	created_at: string;
	updated_at: string;
	replies?: EntryComment[];
}

export type ThreadState = 'open' | 'resolved' | 'all';

function commentsURL(entryId: string): string {
	return `/api/admin/content/entries/${encodeURIComponent(entryId)}/comments`;
}

export async function listComments(client: HttpClient, entryId: string, state: ThreadState = 'all'): Promise<EntryComment[]> {
	const res = await client.get<{ data?: EntryComment[] | null }>(`${commentsURL(entryId)}?state=${state}`);
	return res?.data ?? [];
}

export function createComment(
	client: HttpClient,
	entryId: string,
	body: { body: string; parent_id?: string; mentions: string[] },
): Promise<EntryComment> {
	return client.post<EntryComment>(commentsURL(entryId), body);
}

export function setThreadResolved(client: HttpClient, entryId: string, commentId: string, resolved: boolean): Promise<EntryComment> {
	return client.post<EntryComment>(`${commentsURL(entryId)}/${encodeURIComponent(commentId)}/${resolved ? 'resolve' : 'reopen'}`, {});
}
