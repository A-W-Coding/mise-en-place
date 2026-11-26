/**
 * @module src/utils/images
 * Checking and re-encoding an uploaded image (3b; D11, S4; technical spec
 * §3.2, "Image Uploads").
 *
 * An upload is untrusted, so:
 * 1. Its type comes from its first bytes, not its name or `Content-Type`:
 *    JPEG, PNG or WebP. Anything else, SVG, GIF and HEIC included, is a 415.
 * 2. Its size in pixels is read from its header before anything decodes it,
 *    and over 50 megapixels is a 400, so a small file that would expand into
 *    an enormous image is refused before it can use the Pi's memory. sharp
 *    is given the same limit, in case a header lies.
 * 3. It's turned upright from its orientation tag, then re-encoded to WebP:
 *    the image at most 2,000 px on its longest side, and a 400 px thumbnail.
 *    sharp writes no metadata unless asked, so the GPS position a phone
 *    records, and everything else in the EXIF, is dropped. The upload itself
 *    is never stored.
 */

import sharp from 'sharp';

/** At most this many pixels: 50 megapixels. */
export const MAX_PIXELS = 50_000_000;
/** The stored image's longest side, and the thumbnail's. */
export const FULL_SIZE = 2000;
export const THUMB_SIZE = 400;
/** WebP quality: small files with no visible loss at these sizes. */
const QUALITY = 82;

/** An upload refused, with the status and message the API answers with. */
export class ImageRejected extends Error {
    constructor(
        readonly status: 400 | 415,
        message: string,
    ) {
        super(message);
    }
}

export const UNSUPPORTED_TYPE = 'Only JPEG, PNG and WebP images are accepted.';
export const TOO_MANY_PIXELS = `Images can be at most ${MAX_PIXELS / 1_000_000} megapixels.`;
export const NOT_READABLE = "That file isn't a readable image.";

type ImageType = 'jpeg' | 'png' | 'webp';

/** The image's type from its first bytes, or null for anything else. */
export function sniffType(data: Buffer): ImageType | null {
    if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpeg';
    if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
    if (data.length >= 12 && data.toString('latin1', 0, 4) === 'RIFF' && data.toString('latin1', 8, 12) === 'WEBP') return 'webp';
    return null;
}

/** One encoded file, with what the database keeps about it. */
export interface EncodedImage {
    data: Buffer;
    width: number;
    height: number;
    size: number;
}

/**
 * Check an upload and make the two files to keep.
 *
 * @returns The image (at most 2,000 px) and its thumbnail (at most 400 px), as WebP.
 * @throws ImageRejected for the wrong type (415), too many pixels or an unreadable file (400).
 */
export async function processImage(upload: Buffer): Promise<{ full: EncodedImage; thumb: EncodedImage }> {
    const type = sniffType(upload);
    if (!type) throw new ImageRejected(415, UNSUPPORTED_TYPE);

    // The header only: nothing is decoded yet
    let width: number;
    let height: number;
    try {
        const metadata = await sharp(upload, { limitInputPixels: false }).metadata();
        if (metadata.format !== type || !metadata.width || !metadata.height) throw new Error('No size in the header.');
        width = metadata.width;
        height = metadata.height;
    } catch {
        throw new ImageRejected(400, NOT_READABLE);
    }
    if (width * height > MAX_PIXELS) throw new ImageRejected(400, TOO_MANY_PIXELS);

    const encode = async (size: number): Promise<EncodedImage> => {
        const { data, info } = await sharp(upload, { limitInputPixels: MAX_PIXELS, failOn: 'error' })
            .autoOrient()
            .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
            .webp({ quality: QUALITY })
            .toBuffer({ resolveWithObject: true });
        return { data, width: info.width, height: info.height, size: info.size };
    };
    try {
        return { full: await encode(FULL_SIZE), thumb: await encode(THUMB_SIZE) };
    } catch {
        // A header that looked fine, but data that doesn't decode
        throw new ImageRejected(400, NOT_READABLE);
    }
}
