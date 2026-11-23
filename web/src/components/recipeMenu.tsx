/**
 * @module web/src/components/recipeMenu
 * The items in a recipe's ⋮ menu, the same on its list row and its page.
 */

import { DeleteIcon, EditIcon, PrintIcon } from './Icons';
import type { MenuItem } from './Menu';

/**
 * Edit, Print and Delete. Print opens the recipe with `?print`, and the
 * recipe page prints once it has loaded; the print stylesheet comes in
 * Step 13. Delete asks first, through `DeleteRecipeDialog`.
 */
export function recipeMenuItems(id: string, onDelete: () => void): MenuItem[] {
    return [
        { label: 'Edit', icon: <EditIcon size={18} />, to: `/recipes/${id}/edit` },
        { label: 'Print', icon: <PrintIcon size={18} />, to: `/recipes/${id}?print` },
        { label: 'Delete recipe…', icon: <DeleteIcon size={18} />, danger: true, onSelect: onDelete },
    ];
}
