import { describe, expect, it } from 'vitest';
import { LOGO_MAX_BYTES, logoAddressOk, logoBytesMatch, logoProblem } from './logo';

describe('logo checks', () => {
	it('takes PNG, JPEG and WebP up to the size cap', () => {
		expect(logoProblem({ type: 'image/png', size: 1000 })).toBeNull();
		expect(logoProblem({ type: 'image/jpeg', size: LOGO_MAX_BYTES })).toBeNull();
		expect(logoProblem({ type: 'image/webp', size: 10 })).toBeNull();
		expect(logoProblem({ type: 'image/png', size: LOGO_MAX_BYTES + 1 })).toMatch(/500 KB/);
		expect(logoProblem({ type: 'image/png', size: 0 })).toMatch(/empty/);
	});

	// The media library refuses SVG, and its public route would serve one as
	// an attachment, so an SVG logo is only reachable as an address.
	it('refuses SVG and every other type', () => {
		expect(logoProblem({ type: 'image/svg+xml', size: 10 })).toMatch(/PNG, JPEG or WebP/);
		expect(logoProblem({ type: 'image/gif', size: 10 })).not.toBeNull();
		expect(logoProblem({ type: '', size: 10 })).not.toBeNull();
	});

	it('reads the first bytes rather than the declared type', () => {
		const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
		const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
		const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
		const text = new TextEncoder().encode('<svg onload=alert(1)>');
		expect(logoBytesMatch('image/png', png)).toBe(true);
		expect(logoBytesMatch('image/jpeg', jpeg)).toBe(true);
		expect(logoBytesMatch('image/webp', webp)).toBe(true);
		expect(logoBytesMatch('image/png', jpeg)).toBe(false);
		expect(logoBytesMatch('image/png', text)).toBe(false);
		expect(logoBytesMatch('image/svg+xml', text)).toBe(false);
	});

	it('takes an https address or a published library file, and nothing else', () => {
		expect(logoAddressOk('https://images.example.com/logo.svg')).toBe(true);
		expect(logoAddressOk('/api/v1/media/1/logo.png')).toBe(true);
		expect(logoAddressOk('http://images.example.com/logo.png')).toBe(false);
		expect(logoAddressOk('javascript:alert(1)')).toBe(false);
		expect(logoAddressOk('/api/admin/media/1/download')).toBe(false);
		expect(logoAddressOk('https://a.b/"onerror=')).toBe(false);
	});
});
