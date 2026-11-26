/**
 * @module web/src/routes
 * Every page's address (technical spec §3.4). Cooking mode is a switch on the
 * recipe page, not a page of its own, and Ingredients sit under Options, with
 * Tags and Equipment from 3b.
 */

import type { RouteObject } from 'react-router';
import { Layout } from './components/Layout';
import { EquipmentPage, IngredientsPage } from './pages/IngredientsPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PhotosPage } from './pages/PhotosPage';
import { OptionsPage } from './pages/OptionsPage';
import { RecipeEditorPage } from './pages/RecipeEditorPage';
import { RecipeListPage } from './pages/RecipeListPage';
import { RecipePage } from './pages/RecipePage';
import { TagsPage } from './pages/TagsPage';

export const routes: RouteObject[] = [
    {
        path: '/',
        element: <Layout />,
        children: [
            { index: true, element: <RecipeListPage /> },
            { path: 'recipes/new', element: <RecipeEditorPage /> },
            { path: 'recipes/:id', element: <RecipePage /> },
            { path: 'recipes/:id/edit', element: <RecipeEditorPage /> },
            { path: 'recipes/:id/photos', element: <PhotosPage /> },
            { path: 'options', element: <OptionsPage /> },
            { path: 'options/ingredients', element: <IngredientsPage /> },
            { path: 'options/tags', element: <TagsPage /> },
            { path: 'options/equipment', element: <EquipmentPage /> },
            { path: '*', element: <NotFoundPage /> },
        ],
    },
];
