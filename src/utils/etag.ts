/**
 * @module src/utils/etag
 * ETags and `If-Match` for recipes (F3).
 *
 * A recipe's ETag is its `updatedAt` in milliseconds, quoted. Every change
 * to a recipe sets `updatedAt` (F2), so the ETag changes with it. A client
 * sends the ETag it last saw back in `If-Match`, and a write made after the
 * recipe changed elsewhere gets 412 instead of silently overwriting it.
 */

/**
 * The strong ETag for a recipe last changed at `updatedAt`.
 *
 * @example recipeEtag(new Date(1763836800123)); // '"1763836800123"'
 */
export function recipeEtag(updatedAt: Date): string {
    return `"${updatedAt.getTime()}"`;
}

/**
 * Read an `If-Match` header into the `updatedAt` values it accepts.
 *
 * @param header - The raw header, or undefined if it wasn't sent.
 * @returns `undefined` when there's no header or it contains `*`, meaning
 *          any version will do. Otherwise, the dates named by its strong
 *          ETags. Weak ETags (`W/"..."`) and malformed ones are skipped,
 *          because `If-Match` needs a strong match, so an empty array means
 *          no version can match.
 */
export function ifMatchDates(header: string | undefined): Date[] | undefined {
    if (header === undefined) return undefined;
    const tags = header.split(',').map((tag) => tag.trim());
    if (tags.includes('*')) return undefined;
    return tags.flatMap((tag) => {
        const match = /^"(\d+)"$/.exec(tag);
        return match ? [new Date(Number(match[1]))] : [];
    });
}
