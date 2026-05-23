import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// adapter-node reads BODY_SIZE_LIMIT the same way: a number with an optional
// K, M or G suffix in powers of 1024.
function bytes(value: string): number {
	const unit = ({ K: 1024, M: 1024 ** 2, G: 1024 ** 3 } as Record<string, number>)[value.slice(-1).toUpperCase()];
	return unit ? Number(value.slice(0, -1)) * unit : Number(value);
}

const dockerfile = readFileSync(resolve(process.cwd(), 'Dockerfile'), 'utf8');
const runtime = dockerfile.slice(dockerfile.lastIndexOf('\nFROM '));

describe('the image body size limit', () => {
	it('lets a configuration bundle of the size the engine accepts through, with room for the form', () => {
		const set = /^ENV BODY_SIZE_LIMIT=(\S+)$/m.exec(runtime);
		expect(set, 'the runtime stage sets BODY_SIZE_LIMIT').not.toBeNull();
		const limit = bytes(set![1]);
		expect(limit).toBeGreaterThanOrEqual(8 * 1024 ** 2 + 512 * 1024);
		expect(limit).toBeGreaterThan(bytes('512K'));
	});

	it('is documented in the README env table', () => {
		const readme = readFileSync(resolve(process.cwd(), 'README.md'), 'utf8');
		expect(readme).toMatch(/^\| `BODY_SIZE_LIMIT` \|/m);
	});
});
