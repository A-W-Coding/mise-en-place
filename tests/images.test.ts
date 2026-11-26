/**
 * @module tests/images.test
 * A recipe's images (3b; D11, S4; technical spec §3.2): uploading one, with
 * every upload checked and re-encoded so nothing from the original survives,
 * the main image, deleting, serving the files, and the files following their
 * rows. Every image here is made by sharp inside the test.
 */

import supertest from 'supertest';
import sharp from 'sharp';
import { randomUUID } from 'crypto';
import { existsSync, readdirSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { crc32, deflateSync } from 'zlib';
import { app } from '../src/app.js';
import { prisma } from '../prisma/client.js';
import { mediaDir } from '../src/utils/media.js';
import { setupTestLifecycle } from './helpers/test-lifecycle.js';

const request = supertest(app);

/** One of sharp's image pipelines. */
type Image = ReturnType<typeof sharp>;

/** A plain JPEG, of a size and with whatever metadata a test needs. */
function jpeg(width = 64, height = 48, metadata?: (image: Image) => Image): Promise<Buffer> {
    const image = sharp({ create: { width, height, channels: 3, background: '#c0392b' } }).jpeg();
    return (metadata ? metadata(image) : image).toBuffer();
}

/** A PNG made of nothing but a header claiming `width` × `height`: tiny, but enormous if decoded. */
function pngClaiming(width: number, height: number): Buffer {
    const chunk = (type: string, data: Buffer) => {
        const length = Buffer.alloc(4);
        length.writeUInt32BE(data.length);
        const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(crc32(body));
        return Buffer.concat([length, body, crc]);
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8; // bits per channel
    header[9] = 2; // RGB
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', header),
        chunk('IDAT', deflateSync(Buffer.alloc(0))),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

async function chiliId(): Promise<string> {
    return (await prisma.recipe.findFirstOrThrow({ where: { name: 'Beef Chili' } })).id;
}

function upload(recipeId: string, data: Buffer, name = 'photo.jpg') {
    return request.post(`/api/recipes/${recipeId}/images`).attach('image', data, name);
}

async function uploaded(recipeId: string, data?: Buffer): Promise<{ id: string; orderIndex: number; width: number; height: number; fileSize: number }> {
    const response = await upload(recipeId, data ?? (await jpeg()));
    expect(response.status).toBe(201);
    return response.body;
}

/**
 * A stored file's metadata. Read into memory first: sharp keeps a file it
 * opened by name open, and Windows won't delete an open file.
 */
const storedFile = (name: string) => sharp(readFileSync(join(mediaDir(), name))).metadata();

/** The files in the media folder, sorted. */
const files = () => (existsSync(mediaDir()) ? readdirSync(mediaDir()).sort() : []);
const mainImageOf = async (recipeId: string) => (await prisma.recipe.findUniqueOrThrow({ where: { id: recipeId } })).primaryImageId;

describe("a recipe's images", () => {
    setupTestLifecycle();

    beforeEach(() => rmSync(mediaDir(), { recursive: true, force: true }));
    afterAll(() => rmSync(mediaDir(), { recursive: true, force: true }));

    describe('POST /api/recipes/:id/images', () => {
        test('stores a WebP named after the new row, and a thumbnail, and nothing from the upload', async () => {
            const recipeId = await chiliId();

            const response = await upload(recipeId, await jpeg(), '../../holiday snap.jpg');

            expect(response.status).toBe(201);
            const image = response.body;
            expect(image).toEqual({
                id: expect.stringMatching(/^[0-9a-f-]{36}$/),
                recipeId,
                orderIndex: 0,
                width: 64,
                height: 48,
                fileSize: expect.any(Number),
                createdAt: expect.any(String),
            });
            expect(files()).toEqual([`${image.id}-thumb.webp`, `${image.id}.webp`]);
            const stored = await storedFile(`${image.id}.webp`);
            expect(stored).toMatchObject({ format: 'webp', width: 64, height: 48, size: image.fileSize });
        });

        test("drops the GPS position and every other EXIF field, and turns the photo upright", async () => {
            const recipeId = await chiliId();
            // A phone's photo: taken on its side (orientation 6), with where it was taken
            const photo = await jpeg(64, 48, (image) =>
                image
                    .withExif({
                        IFD0: { Make: 'TestPhone' },
                        IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '51/1 30/1 0/1', GPSLongitudeRef: 'W', GPSLongitude: '0/1 7/1 0/1' },
                    })
                    // sharp writes the orientation tag itself, over any in the EXIF
                    .withMetadata({ orientation: 6 }),
            );
            const before = await sharp(photo).metadata();
            expect(before.exif).toBeDefined();
            expect(before.orientation).toBe(6);
            // The GPS directory's pointer (tag 0x8825) is in the upload's EXIF
            expect(before.exif!.includes(Buffer.from([0x88, 0x25])) || before.exif!.includes(Buffer.from([0x25, 0x88]))).toBe(true);

            const image = await uploaded(recipeId, photo);

            for (const name of [`${image.id}.webp`, `${image.id}-thumb.webp`]) {
                const stored = await storedFile(name);
                expect(stored.exif).toBeUndefined();
                expect(stored.xmp).toBeUndefined();
                expect(stored.orientation).toBeUndefined();
            }
            // Upright: 64 × 48 on its side is 48 × 64
            expect(image).toMatchObject({ width: 48, height: 64 });
        });

        test('scales a big photo to 2,000 px on its longest side, with a 400 px thumbnail, and never enlarges', async () => {
            const recipeId = await chiliId();

            const big = await uploaded(recipeId, await jpeg(3000, 1500));
            const small = await uploaded(recipeId, await jpeg(200, 100));

            expect(big).toMatchObject({ width: 2000, height: 1000 });
            expect(await storedFile(`${big.id}-thumb.webp`)).toMatchObject({ width: 400, height: 200 });
            expect(small).toMatchObject({ width: 200, height: 100 });
            expect(await storedFile(`${small.id}-thumb.webp`)).toMatchObject({ width: 200, height: 100 });
        });

        test('takes PNG and WebP too, whatever the file is called', async () => {
            const recipeId = await chiliId();
            const base = sharp({ create: { width: 30, height: 20, channels: 4, background: '#1f7a5c' } });

            expect((await upload(recipeId, await base.clone().png().toBuffer(), 'a.gif')).status).toBe(201);
            expect((await upload(recipeId, await base.clone().webp().toBuffer(), 'b')).status).toBe(201);
        });

        test.each([
            ['an SVG', () => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'), 'a.svg'],
            ['a GIF', () => sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } }).gif().toBuffer(), 'a.gif'],
            ['a HEIC', () => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic', 'latin1'), Buffer.alloc(64)]), 'a.heic'],
            ['plain text called .jpg', () => Buffer.from('not an image'), 'a.jpg'],
        ])('refuses %s with 415, writing nothing', async (_kind, make, name) => {
            const recipeId = await chiliId();

            const response = await upload(recipeId, await make(), name);

            expect(response.status).toBe(415);
            expect(response.body).toEqual({ error: 'Only JPEG, PNG and WebP images are accepted.' });
            expect(files()).toEqual([]);
            expect(await prisma.image.count()).toBe(0);
        });

        test('refuses a JPEG that starts right but is broken, with 400', async () => {
            const recipeId = await chiliId();
            const broken = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);

            const response = await upload(recipeId, broken);

            expect(response.status).toBe(400);
            expect(response.body).toEqual({ error: "That file isn't a readable image." });
            expect(files()).toEqual([]);
        });

        test('refuses a small file that would expand past 50 megapixels, before decoding it', async () => {
            const recipeId = await chiliId();
            const bomb = pngClaiming(10_000, 10_000);
            expect(bomb.length).toBeLessThan(200);

            const response = await upload(recipeId, bomb, 'tiny.png');

            expect(response.status).toBe(400);
            expect(response.body).toEqual({ error: 'Images can be at most 50 megapixels.' });
            expect(files()).toEqual([]);
        });

        test('refuses a file over 15 MB with 413', async () => {
            const recipeId = await chiliId();
            const huge = Buffer.alloc(15 * 1024 * 1024 + 1);
            huge.set([0xff, 0xd8, 0xff]);

            const response = await upload(recipeId, huge);

            expect(response.status).toBe(413);
            expect(response.body).toEqual({ error: 'Images can be at most 15 MB.' });
            expect(files()).toEqual([]);
            expect(await prisma.image.count()).toBe(0);
        });

        test('refuses an 11th image with 409', async () => {
            const recipeId = await chiliId();
            const photo = await jpeg(16, 16);
            for (let n = 0; n < 10; n += 1) await uploaded(recipeId, photo);

            const response = await upload(recipeId, photo);

            expect(response.status).toBe(409);
            expect(response.body).toEqual({ error: 'A recipe can have at most 10 images.' });
            expect(await prisma.image.count({ where: { recipeId } })).toBe(10);
            expect(files()).toHaveLength(20);
        });

        test('404s a recipe that does not exist, and 400s a form without one image in the field "image"', async () => {
            const recipeId = await chiliId();

            const missing = await upload(randomUUID(), await jpeg());
            const none = await request.post(`/api/recipes/${recipeId}/images`).field('note', 'hello');
            const wrongField = await request.post(`/api/recipes/${recipeId}/images`).attach('photo', await jpeg(), 'a.jpg');
            const twoFiles = await request
                .post(`/api/recipes/${recipeId}/images`)
                .attach('image', await jpeg(), 'a.jpg')
                .attach('image', await jpeg(), 'b.jpg');

            expect(missing.status).toBe(404);
            expect(missing.body).toEqual({ error: 'Recipe not found.' });
            for (const response of [none, wrongField, twoFiles]) {
                expect(response.status).toBe(400);
                expect(response.body).toEqual({ error: 'Send one image, in a form field called "image".' });
            }
            expect(files()).toEqual([]);
        });

        test("moves the recipe's ETag, so an edit opened before it gets a 412", async () => {
            const recipeId = await chiliId();
            const before = await request.get(`/api/recipes/${recipeId}`);

            await uploaded(recipeId);
            const stale = await request.patch(`/api/recipes/${recipeId}`).set('If-Match', before.headers.etag).send({ servings: 9 });

            expect(stale.status).toBe(412);
        });
    });

    describe('the main image', () => {
        test("the first image becomes the main one; later ones don't", async () => {
            const recipeId = await chiliId();

            const first = await uploaded(recipeId);
            await uploaded(recipeId);

            expect(await mainImageOf(recipeId)).toBe(first.id);
        });

        test('deleting the main image makes the next one main, or the one before it if it was the last; the last leaves none', async () => {
            const recipeId = await chiliId();
            const [a, b, c] = [await uploaded(recipeId), await uploaded(recipeId), await uploaded(recipeId)];

            await request.delete(`/api/images/${a.id}`);
            expect(await mainImageOf(recipeId)).toBe(b.id);

            await request.patch(`/api/recipes/${recipeId}`).send({ primaryImageId: c.id });
            await request.delete(`/api/images/${c.id}`);
            expect(await mainImageOf(recipeId)).toBe(b.id);

            await request.delete(`/api/images/${b.id}`);
            expect(await mainImageOf(recipeId)).toBeNull();
        });

        test("deleting another image leaves the main one", async () => {
            const recipeId = await chiliId();
            const main = await uploaded(recipeId);
            const other = await uploaded(recipeId);

            await request.delete(`/api/images/${other.id}`);

            expect(await mainImageOf(recipeId)).toBe(main.id);
        });

        test("primaryImageId chooses any of the recipe's images, null clears it, and another recipe's is refused", async () => {
            const recipeId = await chiliId();
            const [, second] = [await uploaded(recipeId), await uploaded(recipeId)];
            const otherRecipe = await request.post('/api/recipes').send({ name: 'Toast' });
            const theirs = await uploaded(otherRecipe.body.id);

            const chosen = await request.patch(`/api/recipes/${recipeId}`).send({ primaryImageId: second.id });
            const refused = await request.patch(`/api/recipes/${recipeId}`).send({ primaryImageId: theirs.id, servings: 9 });
            const cleared = await request.patch(`/api/recipes/${recipeId}`).send({ primaryImageId: null });

            expect(chosen.body.primaryImageId).toBe(second.id);
            expect(refused.status).toBe(400);
            expect(refused.body).toEqual({ error: "primaryImageId must be one of this recipe's images." });
            expect(cleared.body.primaryImageId).toBeNull();
            // The refused PATCH changed nothing else either
            expect(cleared.body.servings).not.toBe(9);
        });

        test('a new recipe may only send a null primaryImageId: it has no images yet', async () => {
            const recipeId = await chiliId();
            const image = await uploaded(recipeId);

            const withNull = await request.post('/api/recipes').send({ name: 'Toast', primaryImageId: null });
            const withOne = await request.post('/api/recipes').send({ name: 'Crumpets', primaryImageId: image.id });
            const notAnId = await request.post('/api/recipes').send({ name: 'Muffins', primaryImageId: 'cover.jpg' });

            expect(withNull.status).toBe(201);
            expect(withOne.status).toBe(400);
            expect(withOne.body).toEqual({ error: "primaryImageId must be one of this recipe's images." });
            expect(await prisma.recipe.count({ where: { name: 'Crumpets' } })).toBe(0);
            expect(notAnId.body.fields).toEqual({ primaryImageId: 'Must be an image id or null.' });
        });
    });

    describe('DELETE /api/images/:id', () => {
        test('removes the row and both files, and moves the recipe on', async () => {
            const recipeId = await chiliId();
            const keep = await uploaded(recipeId);
            const gone = await uploaded(recipeId);
            const before = (await prisma.recipe.findUniqueOrThrow({ where: { id: recipeId } })).updatedAt;

            const response = await request.delete(`/api/images/${gone.id}`);

            expect(response.status).toBe(200);
            expect(response.body).toEqual({ message: 'Image deleted successfully.' });
            expect(files()).toEqual([`${keep.id}-thumb.webp`, `${keep.id}.webp`]);
            expect(await prisma.image.count()).toBe(1);
            expect((await prisma.recipe.findUniqueOrThrow({ where: { id: recipeId } })).updatedAt.getTime()).toBeGreaterThan(before.getTime());
        });

        test('404s an image that is not there', async () => {
            const response = await request.delete(`/api/images/${randomUUID()}`);

            expect(response.status).toBe(404);
            expect(response.body).toEqual({ error: 'Image not found.' });
        });

        test("deleting a recipe deletes its images' files, and no one else's", async () => {
            const recipeId = await chiliId();
            await uploaded(recipeId);
            await uploaded(recipeId);
            const other = await request.post('/api/recipes').send({ name: 'Toast' });
            const theirs = await uploaded(other.body.id);

            const response = await request.delete(`/api/recipes/${recipeId}`);

            expect(response.status).toBe(200);
            expect(files()).toEqual([`${theirs.id}-thumb.webp`, `${theirs.id}.webp`]);
            expect(await prisma.image.count()).toBe(1);
        });
    });

    describe('reading them', () => {
        test('a recipe has its images in upload order; a list row and the snapshot have what they need', async () => {
            const recipeId = await chiliId();
            const [a, b] = [await uploaded(recipeId), await uploaded(recipeId)];

            const recipe = await request.get(`/api/recipes/${recipeId}`);
            const list = await request.get('/api/recipes');
            const snapshot = await request.get('/api/sync');

            expect(recipe.body.images.map((image: { id: string }) => image.id)).toEqual([a.id, b.id]);
            expect(recipe.body.primaryImageId).toBe(a.id);
            const row = list.body.find((summary: { id: string }) => summary.id === recipeId);
            expect(row.primaryImageId).toBe(a.id);
            expect(row).not.toHaveProperty('images');
            expect(snapshot.body.recipes.find((r: { id: string }) => r.id === recipeId).images).toHaveLength(2);
        });

        test('serves each file as WebP, cached for good, and nothing else under /media', async () => {
            const recipeId = await chiliId();
            const image = await uploaded(recipeId);

            const full = await request.get(`/media/${image.id}.webp`);
            const thumb = await request.get(`/media/${image.id}-thumb.webp`);

            for (const response of [full, thumb]) {
                expect(response.status).toBe(200);
                expect(response.headers['content-type']).toBe('image/webp');
                expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable');
                expect(response.headers['x-content-type-options']).toBe('nosniff');
            }
            expect(Number(full.headers['content-length'])).toBe(image.fileSize);
            for (const path of [`/media/${randomUUID()}.webp`, '/media/', '/media/..%2F.env', `/media/${image.id}.jpg`, '/media/x.webp']) {
                expect((await request.get(path)).status).toBe(404);
            }
        });
    });
});
