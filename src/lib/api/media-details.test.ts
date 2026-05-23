import { describe, expect, it, vi } from 'vitest';
import type { HttpClient } from '@lyeve-labs/client';
import { describeMedia, listMediaChoices, mediaSnippets, parseTags, updateMediaDetails } from './media';

describe('media details', () => {
	it('sends only what changed, to the item', async () => {
		const patch = vi.fn(async () => ({ id: 'a' }));
		await updateMediaDetails({ patch } as unknown as HttpClient, 'a/b', { alt_text: 'x' });
		expect(patch).toHaveBeenCalledWith('/api/admin/media/a%2Fb', { alt_text: 'x' });
	});

	it('asks the AI plugin to describe an item', async () => {
		const post = vi.fn(async () => ({ text: '  A red bicycle.  ' }));
		expect(await describeMedia({ post } as unknown as HttpClient, 'id1')).toBe('A red bicycle.');
		expect(post).toHaveBeenCalledWith('/api/admin/ai/media/id1/describe', {});
	});

	it('reads tags from a comma list', () => {
		expect(parseTags(' bike, red ,, bike ')).toEqual(['bike', 'red']);
	});

	it('writes the pasteable forms with the alt text made safe for each', () => {
		expect(mediaSnippets('https://x/y.png', 'A "red" [bike] <b>')).toEqual({
			url: 'https://x/y.png',
			markdown: '![A "red" bike <b>](https://x/y.png)',
			html: '<img src="https://x/y.png" alt="A &quot;red&quot; [bike] &lt;b>">',
		});
	});
});

describe('listMediaChoices', () => {
	it('offers only published files, by their public path', async () => {
		const get = vi.fn().mockResolvedValue({
			data: [
				{ id: 'a', filename: 'a.jpg', alt_text: '', content_type: 'image/jpeg', public: true, public_url: '/api/v1/media/a/a.jpg' },
				{ id: 'b', filename: 'b.jpg', alt_text: '', content_type: 'image/jpeg', public: false },
			],
		});
		const got = await listMediaChoices({ get } as unknown as HttpClient);
		expect(got.map((c) => c.id)).toEqual(['a']);
		expect(got[0].public_url).toBe('/api/v1/media/a/a.jpg');
	});
});
