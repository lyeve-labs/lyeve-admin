<script lang="ts">
	/**
	 * The strip both audit pages carry.
	 *
	 * Entries and retention are one plugin over one table, so they share one
	 * strip. A legal hold is raised by somebody already reading the entries it
	 * protects.
	 *
	 * These are routes rather than panels in one page. Each half keeps its own
	 * load and its own form actions, a filtered view stays a link somebody can
	 * keep, and neither page pays to render the other's data.
	 */
	import { Tabs } from '@lyeve-labs/ui-kit';
	import { goto } from '$app/navigation';

	interface Props {
		/** Which half is on screen. */
		active: 'entries' | 'retention' | 'sinks';
		/** Entry count, when the page has already read it. */
		entries?: number;
		/** Policies plus holds, when the page has already read them. */
		rules?: number;
		/** Streaming destinations, when the page has already read them. */
		sinks?: number;
	}

	let { active, entries, rules, sinks }: Props = $props();

	const HREF: Record<string, string> = {
		entries: '/admin/audit-log',
		retention: '/admin/audit-log/retention',
		sinks: '/admin/audit-log/sinks'
	};

	const items = $derived([
		{ id: 'entries', label: 'Entries', count: entries },
		{ id: 'retention', label: 'Retention and holds', count: rules },
		{ id: 'sinks', label: 'Streaming', count: sinks }
	]);
</script>

<Tabs {items} {active} onchange={(id) => goto(HREF[id])} />
