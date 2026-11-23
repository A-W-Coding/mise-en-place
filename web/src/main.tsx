/**
 * @module web/src/main
 * The client's entry point: fonts and theme, TanStack Query, then the router.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createBrowserRouter } from 'react-router';
// Inter is bundled with the app rather than loaded from Google, so it works offline (3c)
import '@fontsource-variable/inter';
import './styles/theme.css';
import { queryClient } from './queryClient';
import { routes } from './routes';

const router = createBrowserRouter(routes);

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root element.');

createRoot(root).render(
    <StrictMode>
        <QueryClientProvider client={queryClient}>
            <RouterProvider router={router} />
        </QueryClientProvider>
    </StrictMode>,
);
