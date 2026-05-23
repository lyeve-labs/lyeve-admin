import { describe, expect, it } from 'vitest';
import { MAX_TOPICS, parseTopics, streamUrl } from './stream-lab';

describe('stream lab', () => {
	it('reads a comma list of topics', () => {
		expect(
			parseTopics(' content:posts, *,content:posts ,, schema:changed'),
		).toEqual(['content:posts', '*', 'schema:changed']);
		expect(parseTopics('')).toEqual([]);
		expect(
			parseTopics(Array.from({ length: 30 }, (_, i) => `t${i}`).join(',')),
		).toHaveLength(MAX_TOPICS);
	});

	it('keeps server-sent events on this origin', () => {
		expect(
			streamUrl('sse', ['content:posts', '*'], 'admin.test', 'https:'),
		).toBe('/api/v1/realtime/events?topic=content%3Aposts&topic=*');
		expect(streamUrl('sse', [], 'admin.test', 'https:')).toBe(
			'/api/v1/realtime/events',
		);
	});

	it('opens a WebSocket on the same host, secure when the page is', () => {
		expect(streamUrl('ws', ['a'], 'admin.test', 'https:')).toBe(
			'wss://admin.test/api/v1/ws/connect?topic=a',
		);
		expect(streamUrl('ws', [], 'localhost:5173', 'http:')).toBe(
			'ws://localhost:5173/api/v1/ws/connect',
		);
	});
});
