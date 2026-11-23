/**
 * @module src/app
 * Express application setup for the mise-en-place API.
 *
 * Registers JSON body parsing, route modules, a JSON 404 for unknown API
 * paths, and the global error handler. Exported separately from the server so that tests can
 * import `app` without starting a listener.
 */

import express from 'express';
import healthRouter from './routes/health.js';
import ingredientsRouter from './routes/ingredients.js';
import recipesRouter from './routes/recipes.js';
import { globalErrorHandler } from './middleware/error-handler.js';
import { corsPolicy } from './middleware/cors.js';

const app = express();

// ── CORS (allowed origins come from CORS_ORIGINS; none if unset) ────────────
app.use(corsPolicy());

// ── Body Parsing ────────────────────────────────────────────────────────────
app.use(express.json());

// ── Route Modules ───────────────────────────────────────────────────────────
app.use('/api/health', healthRouter);
app.use('/api/ingredients', ingredientsRouter);
app.use('/api/recipes', recipesRouter);

// ── Unknown API paths: JSON, not Express's HTML page ────────────────────────
app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found.' });
});

// ── Error Handling (must be registered last) ────────────────────────────────
app.use(globalErrorHandler);

export { app };
