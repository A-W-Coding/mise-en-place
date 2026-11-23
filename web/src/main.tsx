/**
 * @module web/src/main
 * The client's entry point: fonts and theme, the saved preferences, TanStack
 * Query, the router, and the service worker that lets the app install and
 * open offline.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createBrowserRouter } from 'react-router';
import { registerSW } from 'virtual:pwa-register';
// Inter is bundled with the app rather than loaded from Google, so it works offline (3c)
import '@fontsource-variable/inter';
import './styles/theme.css';
import { applyPreferences, loadPreferences } from './preferences';
import { queryClient } from './queryClient';
import { routes } from './routes';

// Before the first render, so a chosen theme or text size never flashes the default
applyPreferences(loadPreferences());

const router = createBrowserRouter(routes);

// Registers the service worker in production builds (it does nothing in dev).
// When a new deploy's worker takes over, the page reloads into it: that happens
// right after the app starts, since that's when the browser checks for one.
registerSW({ immediate: true });

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root element.');

createRoot(root).render(
    <StrictMode>
        <QueryClientProvider client={queryClient}>
            <RouterProvider router={router} />
        </QueryClientProvider>
    </StrictMode>,
);
