/**
 * The settings hub: every settings page, grouped by what the reader came to
 * change, with a line saying what each one holds.
 *
 * The hub owns no content of its own. Anything it carried would be a second
 * copy of something another page owns, such as the content API and its tokens
 * on API access or the theme on Your account, so the hub only points.
 *
 * Which entries a reader sees is not decided here. An instance entry is shown
 * when the sidebar would show it, read from the tree `adminNav` built for the
 * reader's roles and this instance's plugins, so the hub and the sidebar
 * cannot disagree about who may open a page. Only the personal pages, which
 * have no sidebar row, are listed on their own terms: the account page always,
 * and each of the other two while the plugin behind it runs.
 */
import type { NavNode, NavTree } from '@lyeve-labs/ui-kit';
import { MonitorSmartphone, ShieldCheck, UserRound } from '@lucide/svelte';

export interface HubEntry {
	id: string;
	label: string;
	href: string;
	description: string;
	icon?: NavNode['icon'];
}

export interface HubGroup {
	id: string;
	label: string;
	description: string;
	entries: HubEntry[];
}

/** What each sidebar entry holds, in the words the hub shows under it. */
const DESCRIBE: Readonly<Record<string, string>> = {
	customization: "This tenant's name, logo and colors, its dashboard, its menu and pages of its own.",
	localization: 'The languages content is kept in, and the order a missing translation falls back through.',
	email: 'How mail is sent: the provider pool, and the fallback transport behind it.',
	recommendations: 'Similar and trending entries and a feed per reader, computed from what readers do.',
	permissions: 'Content and flow access per role, as rules over every schema, one schema, or one flow.',
	security: 'What is protecting this instance right now, read from the running engine.',
	oauth: 'OpenID Connect and OAuth 2.0 providers people can sign in with.',
	saml: 'SAML identity providers people sign in through, and their certificates.',
	scim: 'Identity providers allowed to create and remove accounts without anybody signing in.',
	'rate-limits': 'Every limit a request passes through, and who is close to one right now.',
	'tenant-rate-limits': "This tenant's own limit, the addresses it always allows or refuses, and what was refused.",
	captcha: "The captcha this tenant's own pages and flows check. The admin login keeps the install's.",
	'api-access': 'How external apps authenticate, what each role may do, and a token to try it with.',
	'api-keys': 'Machine-to-machine credentials for the content API, with their usage.',
	'admin-tokens': 'Scoped, expiring credentials for scripts that call the admin API, and what each one did.',
	grpc: 'The gRPC listener and what answers there.',
	graphql: 'The schema generated from your content types, where it answers, and the allowed queries.',
	'message-broker': 'Where content events are published, and whether they are arriving.',
	storage: 'Where uploads are written, and which provider receives them.',
	residency: "The regions this instance runs in, and which tenant's data sits in each.",
	gdpr: 'Every piece of personal data held for one subject, exported or erased.',
	pii: 'What is redacted from responses and logs, and who has read it unmasked.',
	license: 'The license this instance runs on, and where a new key is activated.',
	configuration: 'Every setting the engine reads, and the layer each value came from.',
	'config-sync': 'Export this configuration as one bundle, and compare, dry run and apply a bundle from another instance.',
};

/** The instance groups, by purpose, each naming sidebar entries by id. */
const GROUPS: readonly { id: string; label: string; description: string; ids: readonly string[] }[] = [
	{
		id: 'workspace',
		label: 'Workspace',
		description: 'How this admin looks and what it offers its team.',
		ids: ['customization', 'localization', 'email', 'recommendations'],
	},
	{
		id: 'access',
		label: 'Sign-in and access',
		description: 'Who may sign in, on whose word, and what each role may do.',
		ids: ['permissions', 'security', 'oauth', 'saml', 'scim', 'rate-limits', 'tenant-rate-limits', 'captcha'],
	},
	{
		id: 'apis',
		label: 'APIs and delivery',
		description: 'How other systems reach the content and hear about changes.',
		ids: ['api-access', 'api-keys', 'admin-tokens', 'grpc', 'graphql', 'message-broker'],
	},
	{
		id: 'data',
		label: 'Data and compliance',
		description: 'Where data lives, how long it is kept, and what an auditor asks for.',
		// Retention is a tab of the audit log, beside the entries the policies
		// delete and the holds protect.
		ids: ['storage', 'residency', 'gdpr', 'pii'],
	},
	{
		id: 'instance',
		label: 'Instance',
		description: 'The license, the settings the engine runs on, and moving them between instances.',
		ids: ['license', 'configuration', 'config-sync'],
	},
];

function leaves(tree: NavTree): Map<string, NavNode> {
	const out = new Map<string, NavNode>();
	const walk = (nodes: NavTree) => {
		for (const node of nodes) {
			if (node.href !== undefined) out.set(node.id, node);
			if (node.children) walk(node.children);
		}
	};
	walk(tree);
	return out;
}

/** Which of the personal pages the instance can serve, by whether each one's plugin runs. */
export interface PersonalPages {
	twoFactor: boolean;
	trustedDevices: boolean;
}

/**
 * The hub for one reader: their own pages first, then every instance group
 * that holds at least one page the reader's sidebar offers.
 */
export function settingsHub(tree: NavTree, personal: PersonalPages): HubGroup[] {
	const byId = leaves(tree);
	const account: HubGroup = {
		id: 'account',
		label: 'Your account',
		description: 'Settings that are yours, whatever your role.',
		entries: [
			{ id: 'account', label: 'Account and appearance', href: '/admin/settings/account', icon: UserRound, description: 'Your email and roles, and the color scheme this admin uses for you.' },
			...(personal.twoFactor
				? [{ id: 'mfa', label: 'Two-factor authentication', href: '/admin/settings/mfa', icon: ShieldCheck, description: 'A second step at sign-in, from an authenticator app, and your recovery codes.' }]
				: []),
			...(personal.trustedDevices
				? [{ id: 'devices', label: 'Trusted devices', href: '/admin/settings/devices', icon: MonitorSmartphone, description: 'The browsers that skip the second step, and a way to forget them.' }]
				: []),
		],
	};
	const groups = GROUPS.map((g) => ({
		id: g.id,
		label: g.label,
		description: g.description,
		entries: g.ids.flatMap((id): HubEntry[] => {
			const node = byId.get(id);
			if (!node?.href) return [];
			return [
				{
					id,
					label: node.label,
					href: node.href,
					description: DESCRIBE[id] ?? '',
					icon: node.icon,
					// No badge. A page's own header carries its beta mark, and a
					// mark on the way to a page would single out some of the pages
					// that are equally beta.
				},
			];
		}),
	})).filter((g) => g.entries.length > 0);
	return [account, ...groups];
}

/** Every instance entry id the hub knows how to place, for the test that keeps it complete. */
export const HUB_IDS: readonly string[] = GROUPS.flatMap((g) => g.ids);
