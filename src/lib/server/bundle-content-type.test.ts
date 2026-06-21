import { describe, expect, it } from 'vitest';
import { bundleContentType } from './flow-import';

describe('bundleContentType', () => {
	it('names the type from the extension', async () => {
		expect(await bundleContentType(new File(['a: 1'], 'schemas.yml', { type: '' }))).toBe('application/yaml');
		expect(await bundleContentType(new File(['a: 1'], 'Schemas.YAML'))).toBe('application/yaml');
		expect(await bundleContentType(new File(['{}'], 'schemas.json'))).toBe('application/json');
	});

	it('ignores an empty or generic browser type and reads the first character', async () => {
		expect(await bundleContentType(new File(['  {"schemas":[]}'], 'bundle', { type: 'application/octet-stream' }))).toBe(
			'application/json',
		);
		expect(await bundleContentType(new File(['schemas:\n  - name: a'], 'bundle.txt', { type: '' }))).toBe('application/yaml');
	});
});
