import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { authedClient } from '$lib/server/authz';
import { AI_OK, aiGate, type AiGate } from '$lib/server/ai-load';
import { pageWindow, pastEndOffset, withOffset } from '$lib/api/list';
import { listTranscripts, TRANSCRIPT_KINDS, type Transcript } from '$lib/api/ai';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export const load: PageServerLoad = async (event) => {
	const client = authedClient(event);
	const { limit, offset } = pageWindow(event.url, DEFAULT_LIMIT, MAX_LIMIT);
	const kindRaw = event.url.searchParams.get('kind') ?? '';
	const kind = (TRANSCRIPT_KINDS as string[]).includes(kindRaw) ? kindRaw : '';
	const subjectKind = event.url.searchParams.get('subject_kind') ?? '';
	const subjectId = event.url.searchParams.get('subject_id') ?? '';

	let gate: AiGate = AI_OK;
	let transcripts: Transcript[] = [];
	let total: number | null = null;
	let hasMore = false;
	try {
		const page = await listTranscripts(client, { limit: limit + 1, offset, kind, subject_kind: subjectKind, subject_id: subjectId });
		transcripts = page.rows.slice(0, limit);
		total = page.total;
		hasMore = total === null ? page.rows.length > limit : offset + transcripts.length < total;
	} catch (err) {
		gate = aiGate(err, event, 'transcripts');
	}

	const back = pastEndOffset(transcripts.length, limit, offset, total);
	if (back !== null) redirect(307, withOffset(event.url, back));

	return { gate, transcripts, total, limit, offset, hasMore, kind, subjectKind, subjectId };
};
