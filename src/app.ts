/**
 * @module src/app
 * Express application setup for the mise-en-place API.
 *
 * Registers compression, CORS, JSON body parsing, route modules, a JSON 404
 * for unknown API paths, the built web client (F1), and the global error
 * handler. Exported separately from the server so that tests can import
 * `app` without starting a listener.
 */

import express from 'express';
import compression from 'compression';
import healthRouter from './routes/health.js';
import ingredientsRouter from './routes/ingredients.js';
import recipesRouter from './routes/recipes.js';
import syncRouter from './routes/sync.js';
import { globalErrorHandler } from './middleware/error-handler.js';
import { corsPolicy } from './middleware/cors.js';
import { webClient, webDistDir } from './middleware/web-client.js';

const app = express();

// ── Compression (gzip, when the browser accepts it) ─────────────────────────
// First, so it covers every response: the snapshot (3c) and the web client's
// files as much as the API. It skips responses under 1 kB, where it saves
// little, and types that are already compressed, such as images.
app.use(compression());

// ── CORS (allowed origins come from CORS_ORIGINS; none if unset) ────────────
app.use(corsPolicy());

// ── Body Parsing ────────────────────────────────────────────────────────────
app.use(express.json());

// ── Route Modules ───────────────────────────────────────────────────────────
app.use('/api/health', healthRouter);
app.use('/api/ingredients', ingredientsRouter);
app.use('/api/recipes', recipesRouter);
app.use('/api/sync', syncRouter);

// ── Unknown API paths: JSON, not Express's HTML page ────────────────────────
app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found.' });
});

// ── The web client, from the same origin (F1) ───────────────────────────────
app.use(webClient(webDistDir()));

// ── Error Handling (must be registered last) ────────────────────────────────
app.use(globalErrorHandler);

export { app };
