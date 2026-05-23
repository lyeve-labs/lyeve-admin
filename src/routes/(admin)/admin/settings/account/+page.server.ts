import type { PageServerLoad } from './$types';
import { PLUGIN } from '$lib/plugin-names';
import { runs } from '$lib/plugins';

export const load: PageServerLoad = async ({ parent }) => {
	const { user, plugins } = await parent();
	return { user, remembersDevices: runs(plugins, PLUGIN.deviceFingerprint) };
};
