import type { PageServerLoad, Actions } from './$types';
import { error, fail, redirect } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionError } from '$lib/server/action-error';
import { adminNav, navLeaves } from '$lib/nav';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import { listMediaChoices, type MediaChoice } from '$lib/api/media';
import { getDashboardLayout, type DashboardLayout } from '$lib/api/custom-dashboard';
import { LOGO_MAX_BYTES, LOGO_TYPES, logoAddressOk } from '$lib/logo';
import { importMedia, importRefusal, isForeignAddress } from '$lib/api/media';
import { LogoRejected, uploadLogo } from '$lib/server/logo-upload';
import {
	EMPTY_SETTINGS,
	deleteCustomPage,
	getCustomization,
	parseAccent,
	saveCustomPage,
	saveCustomization,
	slugify,
	type CustomLink,
	type CustomizationSettings,
} from '$lib/api/customization';

const ROLES = ['viewer', 'editor', 'admin'];

export const load: PageServerLoad = async (event) => {
	const { user, plugins } = await event.parent();
	if (!user.roles.some((r) => r === 'admin' || r === 'super_admin')) error(403, 'Requires the admin role');
	const locked = {
		entitled: false,
		settings: EMPTY_SETTINGS,
		pages: [],
		navChoices: [],
		mediaChoices: [] as MediaChoice[],
		dashboard: null as DashboardLayout | null,
	};
	// The shell says why the page is unavailable while the plugin does not run.
	if (notRunning(plugins, PLUGIN.multitenant)) return locked;
	const client = authedClient(event);
	// Read fresh rather than from the shell, so a save shows what the engine
	// stored and not what the layout read before it. The plugin's answer also
	// says whether this tenant may shape its admin at all.
	const custom = await getCustomization(client).catch(() => null);
	if (!custom) error(503, 'The customization could not be read.');
	if (!custom.entitled) return locked;
	const [mediaChoices, dashboard] = await Promise.all([
		Promise.resolve()
			.then(() => listMediaChoices(client))
			.catch((): MediaChoice[] => []),
		getDashboardLayout(client).catch((): DashboardLayout | null => null),
	]);
	return {
		entitled: true,
		settings: custom.settings,
		pages: custom.pages,
		// Chosen from the stock menu this operator sees, so an entry the
		// tenant hid can be brought back.
		navChoices: navLeaves(adminNav(user.roles, { plugins })),
		mediaChoices,
		dashboard,
	};
};

async function current(event: Parameters<Actions[string]>[0]): Promise<CustomizationSettings> {
	return (await getCustomization(authedClient(event))).settings;
}

function roleList(form: FormData): string[] {
	return form
		.getAll('roles')
		.map(String)
		.filter((r) => ROLES.includes(r));
}

/*
 * The logo and the tab icon are two images on one path: an address or a file,
 * kept in the media library and published there, then stored on the brand.
 * Each action answers in its own keys, so a page holding both says which one
 * a message is about.
 */
type BrandImage = 'logo' | 'favicon';
const IMAGE: Record<BrandImage, { field: 'logo_url' | 'favicon_url'; noun: string; file: string }> = {
	logo: { field: 'logo_url', noun: 'logo', file: 'logo' },
	favicon: { field: 'favicon_url', noun: 'tab icon', file: 'favicon' },
};

type ImageResult = { error?: string; field?: string; imported?: boolean; removed?: boolean };

async function saveImageAddress(event: Parameters<Actions[string]>[0], kind: BrandImage): Promise<ImageResult> {
	await requireRole(event, ['admin', 'super_admin']);
	const { field, noun } = IMAGE[kind];
	const url = String((await event.request.formData()).get(field) ?? '').trim();
	if (url && !logoAddressOk(url)) {
		return { error: `A ${noun} address is an https URL or a published media library file.`, field: 'An https URL' };
	}
	const client = authedClient(event);
	// The admin loads images only from its own origin, so an image on another
	// site is copied into the media library and served from here.
	let stored = url;
	let imported = false;
	if (url && isForeignAddress(url)) {
		try {
			const item = await importMedia(client, { url, public: true, max_bytes: LOGO_MAX_BYTES, folder: '/branding' });
			if (!(LOGO_TYPES as readonly string[]).includes(item.content_type) || !item.public_url) {
				await client.delete(`/api/admin/media/${encodeURIComponent(item.id)}`).catch(() => undefined);
				return { error: `A ${noun} is a PNG, JPEG or WebP image.`, field: 'Not a PNG, JPEG or WebP image' };
			}
			stored = item.public_url;
			imported = true;
		} catch (err) {
			return { error: importRefusal(actionError(err, 'The image at that address could not be imported.')), field: 'Could not be imported' };
		}
	}
	try {
		const settings = await current(event);
		settings.brand = { ...settings.brand, [field]: stored };
		await saveCustomization(client, settings);
		return url ? { imported } : { removed: true };
	} catch (err) {
		return { error: actionError(err, `The ${noun} could not be saved.`) };
	}
}

async function saveImageUpload(event: Parameters<Actions[string]>[0], kind: BrandImage): Promise<ImageResult> {
	await requireRole(event, ['admin', 'super_admin']);
	const { field, noun, file: name } = IMAGE[kind];
	const file = (await event.request.formData()).get(name);
	if (!(file instanceof File) || file.size === 0) return { error: 'Choose an image to upload.' };
	try {
		const url = await uploadLogo(event, file, noun);
		const settings = await current(event);
		settings.brand = { ...settings.brand, [field]: url };
		await saveCustomization(authedClient(event), settings);
		return {};
	} catch (err) {
		if (err instanceof LogoRejected) return { error: err.message };
		return { error: actionError(err, `The ${noun} could not be saved.`) };
	}
}

export const actions: Actions = {
	brand: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const form = await event.request.formData();
		const accent = parseAccent(String(form.get('accent') ?? ''));
		if (accent === null) return fail(400, { brandError: 'The accent is a color written #RRGGBB, such as #0a7cff.' });
		try {
			const settings = await current(event);
			// The logo and the tab icon have their own forms and actions, so
			// this one keeps whatever images are stored.
			settings.brand = {
				...settings.brand,
				name: String(form.get('name') ?? '').trim(),
				accent,
				welcome: String(form.get('welcome') ?? '').trim(),
			};
			await saveCustomization(authedClient(event), settings);
			return { brandSaved: true };
		} catch (err) {
			return fail(400, { brandError: actionError(err, 'The brand could not be saved.') });
		}
	},

	logo: async (event) => {
		const r = await saveImageAddress(event, 'logo');
		if (r.error) return fail(400, { logoError: r.error, ...(r.field ? { fields: { logo_url: r.field } } : {}) });
		if (r.removed) return { logoRemoved: true };
		return r.imported ? { logoSaved: true, logoImported: true } : { logoSaved: true };
	},

	/*
	 * A logo file from the reader's disk: stored in the media library,
	 * published there so it has a stable address anyone can load, and made
	 * the brand's logo, in one step.
	 */
	uploadLogo: async (event) => {
		const r = await saveImageUpload(event, 'logo');
		if (r.error) return fail(400, { logoError: r.error });
		return { logoSaved: true, logoUploaded: true };
	},

	/** The tab icon, by address, taking the logo's path. */
	favicon: async (event) => {
		const r = await saveImageAddress(event, 'favicon');
		if (r.error) return fail(400, { faviconError: r.error, ...(r.field ? { fields: { favicon_url: r.field } } : {}) });
		if (r.removed) return { faviconRemoved: true };
		return r.imported ? { faviconSaved: true, faviconImported: true } : { faviconSaved: true };
	},

	/** The tab icon from the reader's disk, taking the logo's path. */
	uploadFavicon: async (event) => {
		const r = await saveImageUpload(event, 'favicon');
		if (r.error) return fail(400, { faviconError: r.error });
		return { faviconSaved: true, faviconUploaded: true };
	},

	menu: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const form = await event.request.formData();
		try {
			const settings = await current(event);
			settings.menu.hidden = form.getAll('hidden').map(String);
			settings.menu.pinned = form.getAll('pinned').map(String).filter((id) => !settings.menu.hidden.includes(id));
			await saveCustomization(authedClient(event), settings);
			return { menuSaved: true };
		} catch (err) {
			return fail(400, { menuError: actionError(err, 'The menu could not be saved.') });
		}
	},

	addLink: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const form = await event.request.formData();
		const link: CustomLink = {
			label: String(form.get('label') ?? '').trim(),
			url: String(form.get('url') ?? '').trim(),
			roles: roleList(form),
		};
		const fields: Record<string, string> = {};
		if (!link.label) fields.label = 'Required';
		if (!/^https:\/\/\S+$/.test(link.url) && !link.url.startsWith('/admin/')) fields.url = 'An https URL or a path starting /admin/';
		if (Object.keys(fields).length > 0) return fail(400, { linkError: 'Check the highlighted fields.', fields });
		try {
			const settings = await current(event);
			settings.menu.links = [...settings.menu.links, link];
			await saveCustomization(authedClient(event), settings);
			return { linkSaved: true };
		} catch (err) {
			return fail(400, { linkError: actionError(err, 'The link could not be saved.') });
		}
	},

	removeLink: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const index = Number((await event.request.formData()).get('index'));
		try {
			const settings = await current(event);
			settings.menu.links = settings.menu.links.filter((_, i) => i !== index);
			await saveCustomization(authedClient(event), settings);
			return { linkRemoved: true };
		} catch (err) {
			return fail(400, { menuError: actionError(err, 'The link could not be removed.') });
		}
	},

	home: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const home = String((await event.request.formData()).get('home_page') ?? '');
		try {
			const settings = await current(event);
			settings.home_page = home;
			await saveCustomization(authedClient(event), settings);
			return { homeSaved: true };
		} catch (err) {
			return fail(400, { pagesError: actionError(err, 'The dashboard page could not be saved.') });
		}
	},

	createPage: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const form = await event.request.formData();
		const title = String(form.get('title') ?? '').trim();
		const slug = String(form.get('slug') ?? '').trim() || slugify(title);
		const fields: Record<string, string> = {};
		if (!title) fields.title = 'Required';
		if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) fields.slug = 'Lower-case letters, digits and hyphens';
		if (Object.keys(fields).length > 0) return fail(400, { pageError: 'Check the highlighted fields.', fields });
		try {
			const custom = await getCustomization(authedClient(event));
			if (custom.pages.some((p) => p.slug === slug)) {
				return fail(409, { pageError: `A page already uses ${slug}.`, fields: { slug: 'Taken' } });
			}
			await saveCustomPage(authedClient(event), {
				slug,
				title,
				description: '',
				roles: roleList(form),
				blocks: [],
				position: custom.pages.length,
			});
		} catch (err) {
			return fail(400, { pageError: actionError(err, 'The page could not be created.') });
		}
		redirect(303, `/admin/settings/customization/pages/${slug}`);
	},

	deletePage: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const slug = String((await event.request.formData()).get('slug') ?? '');
		try {
			await deleteCustomPage(authedClient(event), slug);
			return { pageDeleted: true };
		} catch (err) {
			return fail(400, { pagesError: actionError(err, 'The page could not be deleted.') });
		}
	},
};
