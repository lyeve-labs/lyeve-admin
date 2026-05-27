/**
 * Where the plugin list files a plugin.
 *
 * A plugin names its category in the manifest it sends with its status, and
 * the engine keeps that name to a closed set, so every app reading it groups
 * plugins the same way. This is the set, in the order the engine lists it, with the
 * words the list shows for each. A plugin that names no category, or one this
 * console does not know, is filed under Other, after the rest.
 */
export const PLUGIN_CATEGORIES = [
	'content',
	'delivery',
	'access',
	'automation',
	'insight',
	'operations',
	'compliance',
	'ai',
	'platform',
] as const;

export type PluginCategory = (typeof PLUGIN_CATEGORIES)[number];

/** Where a plugin goes when its category is missing or unknown. */
export const OTHER_CATEGORY = 'other';

/** A group of the plugin list: a category of the set, or Other. */
export type CategoryKey = PluginCategory | typeof OTHER_CATEGORY;

/** Every group, in the order the list renders them. */
export const CATEGORY_ORDER: readonly CategoryKey[] = [...PLUGIN_CATEGORIES, OTHER_CATEGORY];

export const CATEGORY_LABEL: Record<CategoryKey, string> = {
	content: 'Content',
	delivery: 'Delivery',
	access: 'Access',
	automation: 'Automation',
	insight: 'Insight',
	operations: 'Operations',
	compliance: 'Compliance',
	ai: 'AI',
	platform: 'Platform',
	other: 'Other',
};

const KNOWN: ReadonlySet<string> = new Set(PLUGIN_CATEGORIES);

/** The group for a category as a plugin sent it. */
export function categoryOf(value: string | null | undefined): CategoryKey {
	return value && KNOWN.has(value) ? (value as PluginCategory) : OTHER_CATEGORY;
}
