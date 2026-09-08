# The faces a printed book embeds

PDF/X requires every font to be embedded, and the base-14 Helvetica this
writer used to reference is exactly what it forbids. Gelato's own product
template embeds a subsetted face and declares PDF/X-4, so referencing was the
one thing our file did that their reference file does not.

**Liberation Sans 2.1.5**, under the SIL Open Font License 1.1 (`LICENSE`),
which permits embedding and redistribution.

It is here rather than any other face because it is **metric-compatible with
Arial, and therefore with Helvetica** for the Latin set: the same advance
widths, so nothing in an already-laid-out book moves.

That compatibility is belt; the braces are that `lib/postcard/pdf.ts` writes a
`/Widths` array taken from `lib/photobook/text.ts` — the very table `measure()`
uses to decide where a line breaks. For a simple font a PDF consumer positions
text from `/Widths`, not from the font program, so the page cannot shift even
if a future face disagrees with the table.

Not subsetted. Subsetting would save about a megabyte in a nine-megabyte book
and needs a glyph-graph walker to do correctly; embedding whole is valid
PDF/X and is what this does until the size matters.
