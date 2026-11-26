/**
 * @module web/src/editor/IngredientPicker
 * The Ingredient box on an editor line: the shared-list picker
 * (`SharedListPicker`) for ingredients. Search the list as you type, pick a
 * match, or create a missing ingredient on the spot (technical spec §3.4);
 * offline, a new one is created when the recipe reaches the server.
 */

import type { PickedIngredient } from './draft';
import { SharedListPicker } from './SharedListPicker';

interface IngredientPickerProps {
    lineNumber: number;
    text: string;
    picked: PickedIngredient | null;
    error?: string;
    errorId: string;
    autoFocus?: boolean;
    onTextChange: (text: string) => void;
    onPick: (ingredient: PickedIngredient) => void;
}

export function IngredientPicker({ lineNumber, text, picked, error, errorId, autoFocus, onTextChange, onPick }: IngredientPickerProps) {
    return (
        <SharedListPicker
            list="ingredients"
            label={`Ingredient, line ${lineNumber}`}
            placeholder="Ingredient"
            text={text}
            picked={picked}
            error={error}
            errorId={errorId}
            autoFocus={autoFocus}
            newHint="New: it's added to the ingredient list when this recipe reaches the server."
            onTextChange={onTextChange}
            onPick={(item) => onPick({ id: item.id, name: item.name })}
        />
    );
}
