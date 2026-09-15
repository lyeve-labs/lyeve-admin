import type { Actions, PageServerLoad } from './$types';
import { error, fail } from '@sveltejs/kit';
import { ApiError } from '@lyeve-labs/client';
import { authedClient, requireUser } from '$lib/server/authz';
import { AI_OK, aiActionError, aiGate, type AiGate } from '$lib/server/ai-load';
import { getTranscript, recapTranscript, type Transcript } from '$lib/api/ai';

export const load: PageServerLoad = async (event) => {
	const { aiSettings } = await event.parent();
	const client = authedClient(event);
	let gate: AiGate = AI_OK;
	let transcript: Transcript | null = null;
	try {
		transcript = await getTranscript(client, event.params.id);
	} catch (err) {
		if (err instanceof ApiError && err.status === 404 && aiSettings?.enabled !== false) {
			error(404, 'Transcript not found');
		}
		gate = aiGate(err, event, 'transcripts');
	}
	return { gate, transcript };
};

export const actions: Actions = {
	// The recap is written by the same tenant provider and stored on the row.
	// It is a costed message on the transcript like any other.
	recap: async (event) => {
		await requireUser(event);
		try {
			const result = await recapTranscript(authedClient(event), event.params.id);
			return { recap: result.recap };
		} catch (err) {
			if (err instanceof ApiError && err.status === 422) return fail(422, { error: 'The transcript has no messages to recap.' });
			return fail(400, { error: aiActionError(err, 'The recap could not be written') });
		}
	},
};
