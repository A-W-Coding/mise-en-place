/**
 * @module src/routes/images
 * Adding and removing a recipe's images (3b; D11, S4; technical spec §3.2).
 *
 * - `POST /api/recipes/:id/images`: one image, as `multipart/form-data` in a
 *   field called `image`, held in memory (multer) and never written to disk
 *   as uploaded. It's checked and re-encoded (`utils/images.ts`), the two
 *   WebP files are written, then the row is added in a transaction that also
 *   sets the recipe's `updatedAt`. If the transaction fails, the files go.
 *   A recipe's first image becomes its main one.
 * - `DELETE /api/images/:id`: the row, then its files. If it was the main
 *   image, the next one in upload order takes over (or, for the last, the one
 *   before it); the last one leaves none.
 *
 * A recipe has at most 10 images. The upload checks before the work of
 * re-encoding, and again inside the transaction, after locking the recipe's
 * row, so two uploads at once can't make it 11.
 */

import { randomUUID } from 'crypto';
import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { Prisma } from '@prisma/client';
import { prisma } from '../../prisma/client.js';
import { isPrismaError } from '../utils/prisma-errors.js';
import { ImageRejected, processImage } from '../utils/images.js';
import { removeImageFiles, writeImageFiles } from '../utils/media.js';

const router = Router();

/** The biggest upload accepted: 15 MB. */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
/** The most images one recipe can have. */
export const MAX_IMAGES = 10;

const TOO_BIG = { error: 'Images can be at most 15 MB.' };
const TOO_MANY = { error: `A recipe can have at most ${MAX_IMAGES} images.` };
const NO_IMAGE = { error: 'Send one image, in a form field called "image".' };
const RECIPE_NOT_FOUND = { error: 'Recipe not found.' };

/** Thrown inside the transaction when the recipe filled up meanwhile: nothing is written. */
class RecipeFull extends Error {}

/** In memory, one file, nothing else: the upload is re-encoded and discarded. */
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 0, parts: 1 },
}).single('image');

/** Run multer, answering its refusals: too big is a 413, anything else about the form a 400. */
function receiveImage(req: Request, res: Response, next: NextFunction): void {
    upload(req, res, (error: unknown) => {
        if (!error) {
            next();
        } else if (error instanceof multer.MulterError) {
            res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json(error.code === 'LIMIT_FILE_SIZE' ? TOO_BIG : NO_IMAGE);
        } else {
            next(error);
        }
    });
}

/**
 * The main image to fall back on when `removed` goes: the next one in
 * upload order, or the one before it if it was the last; none if it was the
 * only one.
 */
async function nextMain(tx: Prisma.TransactionClient, recipeId: string, removed: { id: string; orderIndex: number }) {
    const after = await tx.image.findFirst({
        where: { recipeId, orderIndex: { gt: removed.orderIndex } },
        orderBy: { orderIndex: 'asc' },
    });
    if (after) return after.id;
    const before = await tx.image.findFirst({
        where: { recipeId, orderIndex: { lt: removed.orderIndex } },
        orderBy: { orderIndex: 'desc' },
    });
    return before?.id ?? null;
}

// ── POST /api/recipes/:id/images ────────────────────────────────────────────
/**
 * Add one image to a recipe.
 *
 * @returns 201 with the Image; 400 for no file, an unreadable one, or over 50
 *          megapixels; 404 if the recipe doesn't exist; 409 if it has 10
 *          images already; 413 over 15 MB; 415 if not JPEG, PNG or WebP.
 */
router.post('/recipes/:id/images', async (req: Request, res: Response, next: NextFunction) => {
    const recipeId = req.params.id;
    try {
        // Before reading the upload: a missing or full recipe needn't wait for 15 MB to arrive
        const recipe = await prisma.recipe.findUnique({ where: { id: recipeId }, select: { _count: { select: { images: true } } } });
        if (!recipe) {
            res.status(404).json(RECIPE_NOT_FOUND);
            return;
        }
        if (recipe._count.images >= MAX_IMAGES) {
            res.status(409).json(TOO_MANY);
            return;
        }
    } catch (error) {
        next(error);
        return;
    }

    receiveImage(req, res, async () => {
        if (!req.file) {
            res.status(400).json(NO_IMAGE);
            return;
        }
        const id = randomUUID();
        let written = false;
        try {
            const { full, thumb } = await processImage(req.file.buffer);
            await writeImageFiles(id, full.data, thumb.data);
            written = true;

            const image = await prisma.$transaction(async (tx) => {
                // First, to lock the recipe's row: an upload racing this one waits, then counts this image too
                const locked = await tx.recipe.update({ where: { id: recipeId }, data: { updatedAt: new Date() } });
                const count = await tx.image.count({ where: { recipeId } });
                if (count >= MAX_IMAGES) throw new RecipeFull();
                const last = await tx.image.aggregate({ where: { recipeId }, _max: { orderIndex: true } });
                const created = await tx.image.create({
                    data: {
                        id,
                        recipeId,
                        orderIndex: (last._max.orderIndex ?? -1) + 1,
                        width: full.width,
                        height: full.height,
                        fileSize: full.size,
                    },
                });
                // A recipe's first image becomes its main one
                if (locked.primaryImageId === null) {
                    await tx.recipe.update({ where: { id: recipeId }, data: { primaryImageId: id } });
                }
                return created;
            });
            res.status(201).json(image);
        } catch (error) {
            if (written) await removeImageFiles([id]);
            if (error instanceof ImageRejected) {
                res.status(error.status).json({ error: error.message });
            } else if (error instanceof RecipeFull) {
                res.status(409).json(TOO_MANY);
            } else if (isPrismaError(error, 'P2025')) {
                // Deleted while the image was being made
                res.status(404).json(RECIPE_NOT_FOUND);
            } else {
                next(error);
            }
        }
    });
});

// ── DELETE /api/images/:id ──────────────────────────────────────────────────
/**
 * Delete an image, then its files. The recipe's `updatedAt` moves, and if
 * this was its main image, the next one takes over.
 *
 * @returns 200 on success, or 404 if there's no such image.
 */
router.delete('/images/:id', async (req: Request, res: Response, next: NextFunction) => {
    const id = req.params.id;
    try {
        const removed = await prisma.$transaction(async (tx) => {
            const image = await tx.image.findUnique({ where: { id } });
            if (!image) return null;
            const recipe = await tx.recipe.findUniqueOrThrow({ where: { id: image.recipeId } });
            const main = recipe.primaryImageId === id ? await nextMain(tx, image.recipeId, image) : recipe.primaryImageId;
            // Deleting the row clears primaryImageId (SetNull); the update then names the next one
            await tx.image.delete({ where: { id } });
            await tx.recipe.update({ where: { id: image.recipeId }, data: { primaryImageId: main, updatedAt: new Date() } });
            return image;
        });
        if (!removed) {
            res.status(404).json({ error: 'Image not found.' });
            return;
        }
        await removeImageFiles([id]);
        res.status(200).json({ message: 'Image deleted successfully.' });
    } catch (error) {
        if (isPrismaError(error, 'P2025')) {
            res.status(404).json({ error: 'Image not found.' });
        } else {
            next(error);
        }
    }
});

export default router;
