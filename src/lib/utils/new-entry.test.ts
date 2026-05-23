import { describe, expect, it } from 'vitest';
import type { SchemaField } from '@lyeve-labs/client';
import { entryIdentity, slugify, UNTITLED } from './new-entry';

const field = (name: string, field_type = 'text'): SchemaField =>
	({ name, field_type }) as SchemaField;

describe('slugify', () => {
	it('lowercases and joins words with a hyphen', () => {
		expect(slugify('Contact Form')).toBe('contact-form');
	});

	it('keeps the word when it strips a diacritic', () => {
		expect(slugify('Café Menu')).toBe('cafe-menu');
	});

	it('drops punctuation rather than encoding it', () => {
		// The store refuses a percent sign and every control character, so a
		// slug that needs escaping is a slug that cannot be addressed.
		expect(slugify('50% off! (today)')).toBe('50-off-today');
	});

	it('leaves no leading or trailing hyphen', () => {
		expect(slugify('  -- hello -- ')).toBe('hello');
	});

	it('is empty for text that carries no slug characters', () => {
		expect(slugify('***')).toBe('');
	});
});

describe('entryIdentity', () => {
	it('names the entry by its title', () => {
		const id = entryIdentity({ title: 'Launch post' }, [field('title')]);
		expect(id.title).toBe('Launch post');
		expect(id.slug).toMatch(/^launch-post-[a-z0-9]{6}$/);
	});

	it('takes a slug the operator typed, collisions and all', () => {
		// The field is on the form and the conflict message names it, so the
		// operator can fix a 409. A derived slug has nobody to fix it.
		const id = entryIdentity({ title: 'Launch post', slug: 'launch' }, [
			field('title'),
			field('slug'),
		]);
		expect(id.slug).toBe('launch');
	});

	it('falls back to a conventional name field in schema order', () => {
		const id = entryIdentity({ subject: 'Ignored', heading: 'Weekly roundup' }, [
			field('heading'),
			field('subject'),
		]);
		expect(id.title).toBe('Weekly roundup');
	});

	it('names an entry nothing else can name the way the listing does', () => {
		const id = entryIdentity({ active: false }, [field('active', 'boolean')]);
		expect(id.title).toBe(UNTITLED);
		expect(id.slug).toMatch(/^untitled-entry-[a-z0-9]{6}$/);
	});

	it('still produces a slug when the title carries no slug characters', () => {
		const id = entryIdentity({ title: '***' }, [field('title')]);
		expect(id.slug).toMatch(/^entry-[a-z0-9]{6}$/);
	});

	it('gives two entries of the same name two slugs', () => {
		const a = entryIdentity({ title: 'Contact form' }, [field('title')]);
		const b = entryIdentity({ title: 'Contact form' }, [field('title')]);
		expect(a.slug).not.toBe(b.slug);
	});
});
