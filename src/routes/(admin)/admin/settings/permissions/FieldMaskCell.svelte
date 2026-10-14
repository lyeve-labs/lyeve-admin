<script lang="ts">
	import type { Permission } from '@lyeve-labs/client';
	import { WILDCARD, parentOf, type RuleMatrix } from './rules.svelte';

	/**
	 * The fields a rule removes from read responses. Masks add up across the
	 * wildcard rule and a schema rule, so a schema row names the wildcard's
	 * mask beside its own.
	 */
	let {
		rules,
		role,
		schema,
		perm,
	}: { rules: RuleMatrix; role: string; schema: string; perm: Permission | undefined } = $props();
</script>

{#if perm?.field_mask?.length}
	<span class="font-mono text-xs text-fg">{perm.field_mask.join(', ')}</span>
{:else}
	<span class="text-xs text-faint">none</span>
{/if}
{#if parentOf(schema) === WILDCARD && rules.rule(role, WILDCARD)?.field_mask?.length}
	<span class="block text-xs text-faint">
		plus {rules.rule(role, WILDCARD)?.field_mask.join(', ')} from the wildcard rule
	</span>
{/if}
