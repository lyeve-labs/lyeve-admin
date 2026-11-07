<script lang="ts">
	/**
	 * The strip the four rate limit pages carry.
	 *
	 * The instance limits and the live counters are a super admin's, and an
	 * admin reaches only this tenant's controls from the sidebar. So the strip
	 * offers an admin the two tenant tabs and a super admin all four.
	 */
	import { Tabs } from '@lyeve-labs/ui-kit';
	import { goto } from '$app/navigation';

	interface Props {
		/** Which page is on screen. */
		active: 'limits' | 'live' | 'tenant' | 'refusals';
		/** Whether the reader is a super admin, who also gets the instance tabs. */
		superAdmin: boolean;
	}

	let { active, superAdmin }: Props = $props();

	const HREF: Record<string, string> = {
		limits: '/admin/settings/rate-limits',
		live: '/admin/settings/rate-limits/live',
		tenant: '/admin/settings/rate-limits/tenant',
		refusals: '/admin/settings/rate-limits/tenant/refusals'
	};

	const items = $derived([
		...(superAdmin
			? [
					{ id: 'limits', label: 'Limits' },
					{ id: 'live', label: 'Right now' }
				]
			: []),
		{ id: 'tenant', label: 'Tenant controls' },
		{ id: 'refusals', label: 'Refusal history' }
	]);
</script>

<Tabs {items} {active} onchange={(id) => goto(HREF[id])} />
