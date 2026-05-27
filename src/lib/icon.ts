/**
 * How big an icon is, by what it sits next to.
 *
 * Without a ladder the same row action drifts to a different size on each
 * list page, and an icon sized by `h-4 w-4` reads as a class and not as a
 * size.
 *
 * An icon on a line of text matches that text. Everything else is named for
 * the shape of the space it occupies rather than for a number.
 */
export const ICON = {
	/** On the line with `text-xs`: a badge, a chip, a meta line under a title. */
	xs: 12,
	/** On the line with `text-sm`: a button, a row action, a table cell. */
	sm: 14,
	/** A glyph in its own column beside a block of text, not on its baseline. */
	md: 16,
	/** Alone in its box: an empty state, a section medallion, a stat tile. */
	lg: 20,
	/** Standing in for a file that cannot be previewed. */
	placeholder: 40,
} as const;

export type IconSize = (typeof ICON)[keyof typeof ICON];
