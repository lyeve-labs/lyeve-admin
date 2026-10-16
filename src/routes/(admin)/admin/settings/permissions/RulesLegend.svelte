<script lang="ts">
	import { Card } from '@lyeve-labs/ui-kit';
	import { EXEMPT_ROLE } from './rules.svelte';

	/**
	 * The legend under the matrix: how the engine reads a rule, and what each
	 * mark and bar in the matrix stands for.
	 */
</script>

<Card title="How the engine reads these rules">
	<ul class="list-disc space-y-2 pl-5 text-sm text-muted">
		<li>
			With no rule for a schema, its own or the wildcard rule, a role is denied every action on it.
			The gate walks the caller's roles, skips each one whose rule is missing, and answers 403 when
			none of them granted the action.
		</li>
		<li>
			A schema rule replaces the wildcard rule on that schema. The engine reads the schema rule's
			actions alone, so clearing an action there denies it on that schema while the wildcard rule
			keeps granting it everywhere else. A schema rule with no action shuts the role out of that
			schema. A stored grant draws as a filled dot, an inherited one as a ring and a denied action as a dash. A shield marks a role these rules never limit. A role's bar is empty when it grants the action on nothing, half full on some schemas and full on all.
		</li>
		<li>
			{EXEMPT_ROLE} passes the content gate before any rule is read. Every rule stored under it is
			inert, and its rows stay listed so an operator can still find them.
		</li>
		<li>
			A field mask removes the named fields from read responses. Masks add up across the two rules,
			unlike actions, so a wildcard mask applies to every schema.
		</li>
		<li>
			Flows are governed the same way under their own two resources: a rule for one flow replaces
			the All flows rule on that flow. Activate is theirs alone and covers publish, disable,
			rollback, run and test. The wildcard rule does not reach a flow.
		</li>
	</ul>
</Card>
