<script lang="ts">
	import { Card } from '@lyeve-labs/ui-kit';
	import { EXEMPT_ROLE } from './rules.svelte';

	/**
	 * The legend under the matrix: how the engine reads a rule, and what each
	 * mark and bar in the matrix stands for.
	 */
</script>

<Card title="How these rules work">
	<ul class="list-disc space-y-2 pl-5 text-sm text-muted">
		<li>
			A role with no rule for a schema, neither its own nor the wildcard rule,
			is denied every action on it. A request is allowed when any of the caller's roles grants the
			action, and refused with 403 when none does.
		</li>
		<li>
			A schema rule replaces the wildcard rule on that schema. Only the schema rule's actions apply
			there, so clearing an action denies it on that schema while the wildcard rule still grants it
			everywhere else. A schema rule with no action blocks the role from that schema. A filled dot is
			a stored grant, a ring is an inherited grant and a dash is a denied action. A shield marks a role these rules never limit. A role's bar is empty when it grants the action on nothing, half full on some schemas and full on all.
		</li>
		<li>
			{EXEMPT_ROLE} is never limited by these rules. Rules stored for it have no effect, and they stay
			listed so you can find and remove them.
		</li>
		<li>
			A field mask removes the named fields from read responses. Masks add up across the two rules,
			unlike actions, so a wildcard mask applies to every schema.
		</li>
		<li>
			Flows work the same way. A rule for one flow replaces the All flows rule on that flow. Activate
			applies only to flows and covers publish, disable, rollback, run and test. The wildcard rule
			does not apply to flows.
		</li>
	</ul>
</Card>
