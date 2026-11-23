/**
 * @module web/src/editor/IngredientPicker
 * The Ingredient box on an editor line: search the shared list as you type,
 * pick a match, or create a missing ingredient on the spot (technical spec §3.4).
 *
 * It follows the WAI-ARIA combobox pattern with a list popup: the arrow keys
 * move through the suggestions, Enter picks one, Escape closes them. Leaving
 * the box with exactly an existing name typed picks that ingredient, since
 * names are unique; anything else stays unpicked until chosen or created.
 */

import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiRequest } from '../api/client';
import { errorMessage } from '../api/errorMessage';
import { useCreateIngredient } from '../api/mutations';
import type { Ingredient } from '../api/types';
import { PlusIcon } from '../components/Icons';
import type { PickedIngredient } from './draft';
import styles from './Editor.module.css';

/** Suggestions shown at once. */
const SUGGESTIONS = 8;
const SEARCH_DELAY_MS = 200;

/** How the API stores a name, so typed text can be compared with it. */
const normalise = (text: string) => text.trim().toLowerCase();

function useDebounced(value: string, delay: number): string {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const timer = setTimeout(() => setDebounced(value), delay);
        return () => clearTimeout(timer);
    }, [value, delay]);
    return debounced;
}

type Option = { kind: 'match'; ingredient: Ingredient } | { kind: 'create'; name: string };

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

export function IngredientPicker({
    lineNumber,
    text,
    picked,
    error,
    errorId,
    autoFocus,
    onTextChange,
    onPick,
}: IngredientPickerProps) {
    const listId = useId();
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(-1);
    const [createError, setCreateError] = useState<string | null>(null);
    const typed = normalise(text);
    const search = useDebounced(typed, SEARCH_DELAY_MS);
    const create = useCreateIngredient();

    const results = useQuery({
        queryKey: ['ingredients', 'pick', search],
        queryFn: ({ signal }) =>
            apiRequest<Ingredient[]>(
                `/api/ingredients?${new URLSearchParams({ search, limit: String(SUGGESTIONS) })}`,
                { signal },
            ),
        enabled: open && search !== '',
        placeholderData: keepPreviousData,
        staleTime: 30_000,
    });

    const matches = search === '' ? [] : (results.data?.data ?? []);
    const exact = matches.find((ingredient) => ingredient.name === typed);
    // Offer to create only once the results are for what's typed now, so an existing name isn't offered
    const settled = search === typed && results.isSuccess && !results.isPlaceholderData;
    const options: Option[] = [
        ...matches.map((ingredient): Option => ({ kind: 'match', ingredient })),
        ...(settled && typed !== '' && !exact ? [{ kind: 'create', name: typed } as Option] : []),
    ];
    const showList = open && typed !== '' && !(picked && picked.name === typed) && options.length > 0;
    const optionId = (index: number) => `${listId}-${index}`;

    const pick = (ingredient: PickedIngredient) => {
        onPick({ id: ingredient.id, name: ingredient.name });
        setOpen(false);
        setActive(-1);
        setCreateError(null);
    };

    const createAndPick = (name: string) => {
        setCreateError(null);
        create.mutate(name, {
            onSuccess: (result) => pick(result.data),
            onError: async (failure) => {
                // Created elsewhere a moment ago: pick the one that exists
                if (failure.status === 409) {
                    const found = await apiRequest<Ingredient[]>(`/api/ingredients?${new URLSearchParams({ search: name })}`).catch(
                        () => null,
                    );
                    const existing = found?.data.find((ingredient) => ingredient.name === name);
                    if (existing) {
                        pick(existing);
                        return;
                    }
                }
                setCreateError(errorMessage(failure));
            },
        });
    };

    const choose = (option: Option) => {
        if (option.kind === 'match') pick(option.ingredient);
        else createAndPick(option.name);
    };

    const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                setOpen(true);
                setActive((index) => Math.min(index + 1, options.length - 1));
                break;
            case 'ArrowUp':
                event.preventDefault();
                setActive((index) => Math.max(index - 1, 0));
                break;
            case 'Enter': {
                // Enter picks here; it never submits the form from this box
                event.preventDefault();
                const option = showList ? (options[active] ?? (exact ? { kind: 'match', ingredient: exact } : undefined)) : undefined;
                if (option) choose(option);
                break;
            }
            case 'Escape':
                if (showList) {
                    event.preventDefault();
                    setOpen(false);
                    setActive(-1);
                }
                break;
        }
    };

    const onBlur = () => {
        setOpen(false);
        setActive(-1);
        if (!picked && exact) pick(exact);
    };

    const describedBy = [error ? errorId : null, createError ? `${errorId}-create` : null].filter(Boolean).join(' ');

    return (
        <div className={styles.picker}>
            <input
                className={styles.input}
                role="combobox"
                aria-label={`Ingredient, line ${lineNumber}`}
                aria-expanded={showList}
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={showList && active >= 0 ? optionId(active) : undefined}
                aria-invalid={error ? true : undefined}
                aria-describedby={describedBy || undefined}
                placeholder="Ingredient"
                autoComplete="off"
                autoFocus={autoFocus}
                value={text}
                onChange={(event) => {
                    onTextChange(event.target.value);
                    setOpen(true);
                    setActive(-1);
                }}
                onFocus={() => setOpen(true)}
                onBlur={onBlur}
                onKeyDown={onKeyDown}
            />
            <ul id={listId} role="listbox" aria-label="Matching ingredients" className={styles.options} hidden={!showList}>
                {showList &&
                    options.map((option, index) => (
                        <li
                            key={option.kind === 'match' ? option.ingredient.id : 'create'}
                            id={optionId(index)}
                            role="option"
                            aria-selected={index === active}
                            className={`${styles.option} ${option.kind === 'create' ? styles.createOption : ''}`}
                            // Keep focus in the box, so picking doesn't count as leaving it
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => choose(option)}
                        >
                            {option.kind === 'match' ? (
                                option.ingredient.name
                            ) : (
                                <>
                                    <PlusIcon size={16} />
                                    Create ingredient “{option.name}”
                                </>
                            )}
                        </li>
                    ))}
            </ul>
            {createError && (
                <p id={`${errorId}-create`} className={styles.error}>
                    {createError}
                </p>
            )}
        </div>
    );
}
