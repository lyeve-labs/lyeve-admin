import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { authedClient } from '$lib/server/authz';
import { getCustomPage } from '$lib/api/customization';
import { resolveBlocks } from '$lib/server/custom-blocks';

export const load: PageServerLoad = async (event) => {
	const { customization } = await event.parent();
	if (!customization?.entitled) error(404, 'No page has that address.');
	const client = authedClient(event);
	// The engine answers 404 for a page the viewer's roles do not see, the
	// same as for one that does not exist.
	const page = await getCustomPage(client, event.params.slug).catch(() => null);
	if (!page) error(404, 'No page has that address.');
	return { customPage: page, blocks: await resolveBlocks(client, page.blocks) };
};
