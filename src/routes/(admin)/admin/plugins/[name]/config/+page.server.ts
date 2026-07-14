import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// A plugin's settings are configuration like any other: they resolve through
// the same layers, and the configuration page shows where each one comes from
// and says what it does. A form of its own per plugin could only disagree
// with it, so this address opens that page for this plugin.
export const load: PageServerLoad = ({ params }) => {
	redirect(307, `/admin/settings/configuration?plugin=${encodeURIComponent(params.name)}`);
};
