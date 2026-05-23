/**
* The stream lab's URLs. The realtime plugin serves server-sent events at
* /api/v1/realtime/events and WebSocket at /api/v1/ws/connect, both taking
* one ?topic= per topic and every topic when there is none.
*/

export type StreamTransport = 'sse' | 'ws';

/** The plugin caps a connection at this many topics and drops the rest. */
export const MAX_TOPICS = 20;

/** The events the page keeps on screen, newest first. */
export const STREAM_KEEP = 200;

export const SSE_PATH = '/api/v1/realtime/events';
export const WS_PATH = '/api/v1/ws/connect';

/** Topics from a comma list: trimmed, deduplicated, empty ones dropped. */
export function parseTopics(raw: string): string[] {
	const out: string[] = [];
	for (const t of raw.split(',')) {
		const topic = t.trim();
		if (topic && !out.includes(topic)) out.push(topic);
	}
	return out.slice(0, MAX_TOPICS);
}

/**
* The URL to open. Server-sent events stay relative, so the browser sends
* them to this origin with its cookie. A WebSocket needs an absolute ws or
* wss URL on the same host.
*/
export function streamUrl(
	transport: StreamTransport,
	topics: string[],
	host: string,
	protocol: string,
): string {
	const q = new URLSearchParams();
	for (const t of topics) q.append('topic', t);
	const query = q.size ? `?${q}` : '';
	if (transport === 'sse') return `${SSE_PATH}${query}`;
	const scheme = protocol === 'http:' ? 'ws:' : 'wss:';
	return `${scheme}//${host}${WS_PATH}${query}`;
}
