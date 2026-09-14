/**
 * One paint per node category, shared by the palette, the canvas and the
 * inspector so a data node is the same color and icon everywhere it shows.
 * Six categories, six paints. A contributed type carries its plugin's
 * name as its category, and every plugin shares one neutral paint: the puzzle
 * piece in the muted tone, so a contributed node reads as one at a glance and
 * no plugin competes with the built-in colors.
 */

import { Database, GitBranch, Plug, Puzzle, Send, Shuffle, Zap } from '@lucide/svelte';
import type { Component } from 'svelte';

export type CategoryIcon = Component<{ size?: number; class?: string }>;

/** The engine's order for the palette: integration sits between data and transform. */
export const CATEGORY_ORDER = ['data', 'integration', 'transform', 'control', 'output'];

export const CATEGORY_LABEL: Record<string, string> = {
	trigger: 'Trigger',
	data: 'Data',
	integration: 'Integration',
	transform: 'Transform',
	control: 'Control',
	output: 'Output',
};

const ICON: Record<string, CategoryIcon> = {
	trigger: Zap,
	data: Database,
	integration: Plug,
	transform: Shuffle,
	control: GitBranch,
	output: Send,
};

/** Text color for a category's icon and label. */
const TEXT: Record<string, string> = {
	trigger: 'text-brand',
	data: 'text-violet',
	integration: 'text-brand-deep',
	transform: 'text-success',
	control: 'text-warn',
	output: 'text-fg',
};

/** The solid stripe down a node card's left edge. */
const STRIPE: Record<string, string> = {
	trigger: 'bg-brand',
	data: 'bg-violet',
	integration: 'bg-brand-deep',
	transform: 'bg-success',
	control: 'bg-warn',
	output: 'bg-muted',
};

export function categoryIcon(category: string | undefined): CategoryIcon {
	return ICON[category ?? ''] ?? Puzzle;
}

export function categoryText(category: string | undefined): string {
	return TEXT[category ?? ''] ?? 'text-muted';
}

export function categoryStripe(category: string | undefined): string {
	return STRIPE[category ?? ''] ?? 'bg-muted';
}

export function categoryLabel(category: string): string {
	return CATEGORY_LABEL[category] ?? pluginLabel(category);
}

/**
 * A plugin's display name from its registered name, in sentence case:
 * "device-fingerprint" reads "Device fingerprint". The plugins page shows the raw
 * name, so this is the one place the admin humanizes it.
 */
export function pluginLabel(name: string): string {
	const words = name.split(/[\s_-]+/).filter(Boolean);
	if (words.length === 0) return name;
	const text = words.join(' ').toLowerCase();
	return text.charAt(0).toUpperCase() + text.slice(1);
}
