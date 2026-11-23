/**
 * @module web/src/routes
 * Every page's address (technical spec §3.4). Cooking mode is a switch on the
 * recipe page, not a page of its own, and Ingredients sit under Options.
 */

import type { RouteObject } from 'react-router';
import { Layout } from './components/Layout';
import { IngredientsPage } from './pages/IngredientsPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { OptionsPage } from './pages/OptionsPage';
import { RecipeEditorPage } from './pages/RecipeEditorPage';
import { RecipeListPage } from './pages/RecipeListPage';
import { RecipePage } from './pages/RecipePage';

export const routes: RouteObject[] = [
    {
        path: '/',
        element: <Layout />,
        children: [
            { index: true, element: <RecipeListPage /> },
            { path: 'recipes/new', element: <RecipeEditorPage /> },
            { path: 'recipes/:id', element: <RecipePage /> },
            { path: 'recipes/:id/edit', element: <RecipeEditorPage /> },
            { path: 'options', element: <OptionsPage /> },
            { path: 'options/ingredients', element: <IngredientsPage /> },
            { path: '*', element: <NotFoundPage /> },
        ],
    },
];
