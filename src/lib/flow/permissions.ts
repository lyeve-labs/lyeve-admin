/**
 * What a session may do to a flow, read off the engine's permission rules.
 *
 * Flows are governed by the same store as content: a rule names a role, a
 * resource and the actions it grants. The resources are `flows`, every
 * flow of the tenant, and `flow:<slug>`, one of them. The actions are the
 * content four plus `activate`, which covers publish, disable, rollback,
 * run and test. A rule on `flows` is unioned into every `flow:<slug>`, the
 * way the wildcard rule is unioned into every schema.
 *
 * The engine is the authority and answers 403 when a role is short of an
 * action. The flow plugin carries what the caller's roles grant on each
 * flow it lists or gets, and `can_create` beside the list. What is decided
 * here is only whether a control is drawn: a button that can only be
 * refused is noise, and a page that hides the button still renders the
 * refusal if the action is posted anyway.
 */

export const FLOW_ACTIONS = ['create', 'read', 'update', 'delete', 'activate'] as const;
export type FlowAction = (typeof FLOW_ACTIONS)[number];

/** The resource every flow of the tenant is governed by. */
export const ALL_FLOWS = 'flows';
const ONE_FLOW = 'flow:';

export function flowResource(slug: string): string {
	return `${ONE_FLOW}${slug}`;
}

/** Whether a permission resource names flows rather than a schema. */
export function isFlowResource(name: string): boolean {
	return name === ALL_FLOWS || name.startsWith(ONE_FLOW);
}

/** The slug a one-flow resource names, or null for anything else. */
export function flowSlugOf(name: string): string | null {
	return name.startsWith(ONE_FLOW) && name.length > ONE_FLOW.length ? name.slice(ONE_FLOW.length) : null;
}

/** What the reader sees a flow resource called. */
export function flowResourceLabel(name: string): string {
	if (name === ALL_FLOWS) return 'All flows';
	const slug = flowSlugOf(name);
	return slug === null ? name : `flow ${slug}`;
}

/**
 * The actions the caller's roles grant on one flow, as the flow plugin
 * carries them on every flow it lists or gets. A flow that carries none
 * reads as everything granted. The engine still decides, and a 403
 * it answers renders inline.
 */
export function flowGrants(actions: readonly string[] | undefined | null): Record<FlowAction, boolean> {
	const out = {} as Record<FlowAction, boolean>;
	for (const action of FLOW_ACTIONS) out[action] = !Array.isArray(actions) || actions.includes(action);
	return out;
}
