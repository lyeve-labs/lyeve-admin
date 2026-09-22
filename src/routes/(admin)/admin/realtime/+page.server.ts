import type { PageServerLoad } from './$types';
import { authedClient } from '$lib/server/authz';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import {
	REALTIME_OK,
	getPlatformMetrics,
	getSocketMetrics,
	getStreamMetrics,
	realtimeGate,
	type RealtimeGate,
	type SocketMetrics,
	type StreamMetrics,
} from '$lib/api/realtime';

export const load: PageServerLoad = async (event) => {
	const { user, plugins } = await event.parent();
	const superAdmin = user.roles.includes('super_admin');

	// The shell says why the page is unavailable while its plugin does not run.
	if (notRunning(plugins, PLUGIN.realtime)) {
		return {
			stream: null as StreamMetrics | null,
			socket: null as SocketMetrics | null,
			platform: null as StreamMetrics | null,
			gate: { state: 'absent' } as RealtimeGate,
			superAdmin,
		};
	}

	const client = authedClient(event);

	// The two transports are read independently. One of them being absent is
	// the normal case for an install that pushes over the other, and folding
	// them into one request would make either failure look like both.
	const [streamRes, socketRes] = await Promise.allSettled([
		getStreamMetrics(client),
		getSocketMetrics(client),
	]);

	const stream = streamRes.status === 'fulfilled' ? streamRes.value : null;
	const socket = socketRes.status === 'fulfilled' ? socketRes.value : null;

	// The gate describes the plugin, so it is only a refusal when neither
	// transport answered. One transport failing is reported beside it.
	let gate: RealtimeGate = REALTIME_OK;
	if (!stream && !socket) {
		gate = realtimeGate(streamRes.status === 'rejected' ? streamRes.reason : undefined);
	}

	// The per-tenant roster is the operator's view and the engine gates it on
	// the role, so it is not asked for on a tenant admin's behalf.
	let platform: StreamMetrics | null = null;
	if (superAdmin && gate.state === 'ok') {
		platform = await getPlatformMetrics(client).catch(() => null);
	}

	return { stream, socket, platform, gate, superAdmin };
};
