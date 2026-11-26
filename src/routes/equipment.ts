/**
 * @module src/routes/equipment
 * CRUD endpoints for the Equipment resource (3b; technical spec §3.2).
 *
 * Equipment is a shared list, managed exactly like ingredients: names are
 * normalised on write (trimmed, lowercase) and unique, so a taken name is a
 * 409; deleting an item a recipe still uses is refused with 409 (Restrict
 * on RecipeEquipment).
 */

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../../prisma/client.js';
import { isPrismaError } from '../utils/prisma-errors.js';
import { fuzzySearchByName } from '../utils/fuzzy-search.js';
import { parseOr400 } from '../utils/validation.js';
import { equipmentBodySchema } from '../schemas/equipment.js';
import { listQuerySchema } from '../schemas/list-query.js';

const router = Router();

const NOT_FOUND = { error: 'Equipment not found.' };

// ── GET /api/equipment ──────────────────────────────────────────────────────
/**
 * List equipment one page at a time, optionally filtered by a fuzzy search
 * term, as `GET /api/ingredients` does (D6).
 *
 * @returns 200 with an array of items (may be empty), or 400 for a bad query.
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const query = parseOr400(listQuerySchema, req.query, res);
        if (query === null) return;
        const { search, limit, offset } = query;

        if (search) {
            const { matches, total } = await fuzzySearchByName('Equipment', search, { limit, offset });
            const ids = matches.map((m) => m.id);
            const items = await prisma.equipment.findMany({ where: { id: { in: ids } } });

            // Preserve similarity ranking from the fuzzy search
            const sorted = ids.flatMap((id) => items.filter((item) => item.id === id));
            res.status(200).set('X-Total-Count', String(total)).json(sorted);
            return;
        }

        const [items, total] = await Promise.all([
            prisma.equipment.findMany({ orderBy: [{ name: 'asc' }, { id: 'asc' }], take: limit, skip: offset }),
            prisma.equipment.count(),
        ]);
        res.status(200).set('X-Total-Count', String(total)).json(items);
    } catch (error) {
        next(error);
    }
});

// ── GET /api/equipment/:id ──────────────────────────────────────────────────
/** @returns 200 with the item, or 404 if not found. */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const item = await prisma.equipment.findUnique({ where: { id: req.params.id } });
        if (!item) {
            res.status(404).json(NOT_FOUND);
            return;
        }
        res.status(200).json(item);
    } catch (error) {
        next(error);
    }
});

// ── POST /api/equipment ─────────────────────────────────────────────────────
/**
 * Create an item: `{ name }`. A taken name is a 409 (P2002, mapped in the
 * error handler).
 *
 * @returns 201 with the item, 400 on validation failure, or 409 for a taken name.
 */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const body = parseOr400(equipmentBodySchema, req.body, res);
        if (body === null) return;

        const item = await prisma.equipment.create({ data: { name: body.name } });
        res.status(201).json(item);
    } catch (error) {
        next(error);
    }
});

// ── PATCH /api/equipment/:id ────────────────────────────────────────────────
/**
 * Rename an item. Renaming to a taken name is a 409 (P2002).
 *
 * @returns 200 with the item, or 400/404/409 on failure.
 */
router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const body = parseOr400(equipmentBodySchema, req.body, res);
        if (body === null) return;

        const item = await prisma.equipment.update({ where: { id: req.params.id }, data: { name: body.name } });
        res.status(200).json(item);
    } catch (error) {
        if (isPrismaError(error, 'P2025')) {
            res.status(404).json(NOT_FOUND);
        } else {
            next(error);
        }
    }
});

// ── DELETE /api/equipment/:id ───────────────────────────────────────────────
/**
 * Delete an item. Refused with 409 while a recipe uses it (P2003, from the
 * Restrict on RecipeEquipment), as for an ingredient.
 *
 * @returns 200 on success, 404 if not found, or 409 if in use.
 */
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
        await prisma.equipment.delete({ where: { id: req.params.id } });
        res.status(200).json({ message: 'Equipment deleted successfully.' });
    } catch (error) {
        if (isPrismaError(error, 'P2025')) {
            res.status(404).json(NOT_FOUND);
        } else if (isPrismaError(error, 'P2003')) {
            res.status(409).json({ error: 'Cannot delete equipment that is used in recipes.' });
        } else {
            next(error);
        }
    }
});

export default router;
