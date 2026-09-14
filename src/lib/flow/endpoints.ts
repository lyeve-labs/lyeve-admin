/**
 * The addresses a flow answers at, worked out from its trigger the way the
 * flow plugin serves them, for the inspector to show and copy. Nothing here
 * asks the engine: the list follows the canvas, so a changed slug, auth
 * setting, path or protocol shows its effect before the save.
 */

import type { FlowDefinition } from './types';

/** The protocols an HTTP trigger may name, in the order the engine lists them. */
export const PROTOCOLS = ['rest', 'graphql', 'grpc', 'realtime'] as const;
export type Protocol = (typeof PROTOCOLS)[number];

/** The slug shape the engine accepts. */
export const SLUG_PATTERN = /^[a-z][a-z0-9_-]{0,39}$/;

export interface FlowEndpoint {
	/** Stable key for the list and the copy control's id. */
	key: string;
	label: string;
	/** What the reader copies: a URL, or the call to make on a transport. */
	value: string;
	hint?: string;
	/**
	 * The trigger option this address exists through, when it goes past the
	 * trigger's defaults: the custom path, or the protocols for a start other
	 * than REST. The inspector marks the address when the flow plugin locks
	 * that option on this instance.
	 */
	option?: 'path' | 'protocols';
}

/** The protocols a trigger config declares. None named is REST only, as on the engine. */
export function triggerProtocols(config: Record<string, unknown>): Protocol[] {
	const raw = config.protocols;
	if (!Array.isArray(raw) || raw.length === 0) return ['rest'];
	return PROTOCOLS.filter((p) => raw.includes(p));
}

/** Why a slug is refused, or undefined when the engine will take it. */
export function slugError(slug: string): string | undefined {
	if (SLUG_PATTERN.test(slug)) return undefined;
	return 'Lowercase letters, digits, - and _, starting with a letter, at most 40 characters.';
}

/**
 * Every address the flow answers at once it is published. `origin` is the
 * origin the console is served from: a deployment sends /api to the API
 * server, so the same origin reaches the flow.
 */
export function flowEndpoints(origin: string, flowId: string, definition: Pick<FlowDefinition, 'slug' | 'trigger'>): FlowEndpoint[] {
	const { type } = definition.trigger;
	const config = (definition.trigger.config ?? {}) as Record<string, unknown>;
	const slug = definition.slug;
	const path = typeof config.path === 'string' ? config.path : '';
	const out: FlowEndpoint[] = [];

	if (type === 'trigger.webhook') {
		const hint = 'POST, signed with the hex HMAC-SHA256 of the raw body in X-Flow-Signature.';
		out.push({ key: 'hook', label: 'Webhook URL', value: `${origin}/api/v1/flows/hooks/${flowId}`, hint });
		if (path) out.push({ key: 'path', label: 'Custom path', value: `${origin}${path}`, hint, option: 'path' });
		return out;
	}
	if (type !== 'trigger.http') return out;

	const auth = typeof config.auth === 'string' ? config.auth : 'auth';
	const protocols = triggerProtocols(config);
	if (auth === 'admin') {
		out.push({
			key: 'admin',
			label: 'Admin invoke URL',
			value: `${origin}/api/admin/flows/${flowId}/invoke`,
			hint: 'An admin flow answers here only, with an admin session. No transport reaches it.',
		});
		return out;
	}
	if (protocols.includes('rest')) {
		out.push({
			key: 'rest',
			label: 'REST URL',
			value: `${origin}/api/v1/flows/${slug}`,
			hint: 'With a signed-in user or an API key.',
		});
		if (auth === 'public') {
			out.push({ key: 'public', label: 'Public URL', value: `${origin}/api/v1/flows/p/${flowId}`, hint: 'No credentials. Named by id, so a rename leaves it as it is.' });
			if (path) out.push({ key: 'path', label: 'Custom path', value: `${origin}${path}`, hint: 'No credentials.', option: 'path' });
		}
	}
	if (protocols.includes('graphql')) {
		out.push({
			key: 'graphql',
			label: 'GraphQL',
			value: `mutation { runFlow(slug: "${slug}", input: {}) { runId status body } }`,
			hint: `POST to ${origin}/api/v1/graphql.`,
			option: 'protocols',
		});
	}
	if (protocols.includes('grpc')) {
		out.push({
			key: 'grpc',
			label: 'gRPC',
			value: `lyeve.core.v1.FlowService/Run {"slug":"${slug}","input":{}}`,
			hint: 'On the gRPC listener, with a Bearer token.',
			option: 'protocols',
		});
	}
	if (protocols.includes('realtime')) {
		out.push({
			key: 'realtime',
			label: 'Realtime message',
			value: `{"type":"flow.run","ref":"1","slug":"${slug}","input":{}}`,
			hint: `Sent on a socket open at ${origin.replace(/^http/, 'ws')}/api/v1/ws/connect; the answer comes back as flow.result.`,
			option: 'protocols',
		});
	}
	return out;
}
