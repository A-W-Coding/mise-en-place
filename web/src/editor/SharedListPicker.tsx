/**
 * @module web/src/editor/SharedListPicker
 * A box that picks from a shared list as you type: an ingredient on an
 * ingredient line, an item on an equipment line, or a tag (technical spec
 * §3.4; tags and equipment from 3b). Search the list, pick a match, or
 * create a missing one on the spot.
 *
 * It follows the WAI-ARIA combobox pattern with a list popup: the arrow keys
 * move through the suggestions, Enter picks one, Escape closes them. Leaving
 * the box with exactly an existing name typed picks it, since names are
 * unique; anything else stays unpicked until chosen or created.
 *
 * The offline copy (3c) suggests names at once while the API is asked, and
 * instead of it when it can't be reached. Offline, a created name is picked
 * alone: it's created when the recipe reaches the server, or the existing
 * one is used if it was created elsewhere meanwhile.
 *
 * A tag isn't created here: choosing "Create tag" asks the page instead
 * (`onCreate`), which asks for its colour first.
 */

import { useEffect, useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LIMITS } from '../../../shared/limits';
import { ApiError, apiRequest } from '../api/client';
import { errorMessage } from '../api/errorMessage';
import { useCreateShared, type SharedList } from '../api/mutations';
import { tagsFromCopy } from '../api/queries';
import { PlusIcon } from '../components/Icons';
import { loadOfflineCopy, useOfflineCopy, type OfflineCopy } from '../offline/copy';
import { listFromCopy } from '../offline/read';
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

/** Something on a shared list. `color` is a tag's. */
export interface ListItem {
    id: string;
    name: string;
    color?: string | null;
}

/** What a picker picks: an existing item, or a new one by name (a null id). */
export interface Picked {
    id: string | null;
    name: string;
    color?: string | null;
}

/** How each list is worded and limited, and where the copy keeps it. */
const LISTS: Record<SharedList, { noun: string; matching: string; maxLength: number; inCopy: (copy: OfflineCopy) => ListItem[] }> = {
    ingredients: {
        noun: 'ingredient',
        matching: 'Matching ingredients',
        maxLength: LIMITS.ingredientName,
        inCopy: (copy) => copy.data.ingredients,
    },
    equipment: { noun: 'item', matching: 'Matching equipment', maxLength: LIMITS.equipmentName, inCopy: (copy) => copy.data.equipment },
    tags: { noun: 'tag', matching: 'Matching tags', maxLength: LIMITS.tagName, inCopy: tagsFromCopy },
};

type Option = { kind: 'match'; item: ListItem } | { kind: 'create'; name: string };

interface SharedListPickerProps {
    list: SharedList;
    /** The box's name, such as "Ingredient, line 3". */
    label: string;
    placeholder: string;
    text: string;
    picked: Picked | null;
    /** Names not to suggest, such as the tags a recipe has already. */
    exclude?: string[];
    error?: string;
    errorId: string;
    autoFocus?: boolean;
    /** Shown under the box while a new one, picked by name, waits to be created. */
    newHint?: string;
    onTextChange: (text: string) => void;
    onPick: (item: Picked) => void;
    /** Instead of creating it here: a tag asks for its colour first. */
    onCreate?: (name: string) => void;
    /** How a suggestion looks: a tag as its pill. */
    renderItem?: (item: ListItem) => ReactNode;
}

export function SharedListPicker({
    list,
    label,
    placeholder,
    text,
    picked,
    exclude = [],
    error,
    errorId,
    autoFocus,
    newHint,
    onTextChange,
    onPick,
    onCreate,
    renderItem,
}: SharedListPickerProps) {
    const config = LISTS[list];
    const listId = useId();
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(-1);
    const [createError, setCreateError] = useState<string | null>(null);
    const typed = normalise(text);
    const search = useDebounced(typed, SEARCH_DELAY_MS);
    const create = useCreateShared<ListItem>(list);
    const { copy } = useOfflineCopy();
    // The copy's matches, shown while the API is asked
    const standIn = copy && search ? listFromCopy(config.inCopy(copy), search, 0, SUGGESTIONS) : null;

    const results = useQuery({
        queryKey: [list, 'pick', search],
        queryFn: async ({ signal }) => {
            const path = `/api/${list}?${new URLSearchParams({ search, limit: String(SUGGESTIONS) })}`;
            try {
                return await apiRequest<ListItem[]>(path, { signal });
            } catch (error) {
                if (!(error instanceof ApiError) || !error.isNetworkError) throw error;
                // Offline: suggest from the copy, or nothing, so a new one can still be created
                const copy = await loadOfflineCopy();
                return listFromCopy(copy ? config.inCopy(copy) : [], search, 0, SUGGESTIONS);
            }
        },
        enabled: open && search !== '',
        placeholderData: (previous) => standIn ?? previous,
        staleTime: 30_000,
    });

    const found = search === '' ? [] : (results.data?.data ?? []);
    const exact = found.find((item) => item.name === typed);
    const matches = found.filter((item) => !exclude.includes(item.name));
    // Offer to create only once the results are for what's typed now, so an existing name isn't offered.
    // The copy's are, and if the name exists on the server after all, creating it finds that one (409)
    const settled = search === typed && results.isSuccess && (!results.isPlaceholderData || standIn !== null);
    const options: Option[] = [
        ...matches.map((item): Option => ({ kind: 'match', item })),
        ...(settled && typed !== '' && !exact ? [{ kind: 'create', name: typed } as Option] : []),
    ];
    const showList = open && typed !== '' && !(picked && picked.name === typed) && options.length > 0;
    const optionId = (index: number) => `${listId}-${index}`;

    const pick = (item: Picked) => {
        onPick(item.color === undefined ? { id: item.id, name: item.name } : { id: item.id, name: item.name, color: item.color });
        setOpen(false);
        setActive(-1);
        setCreateError(null);
    };

    const createAndPick = (name: string) => {
        setCreateError(null);
        if (name.length > config.maxLength) {
            setCreateError(`Keep the name to ${config.maxLength} characters or fewer.`);
            return;
        }
        if (onCreate) {
            onCreate(name);
            setOpen(false);
            setActive(-1);
            return;
        }
        create.mutate(
            { name },
            {
                onSuccess: (result) => pick(result.data),
                onError: async (failure) => {
                    // Offline: it's created when the recipe reaches the server
                    if (failure.isNetworkError) {
                        pick({ id: null, name });
                        return;
                    }
                    // Created elsewhere a moment ago: pick the one that exists
                    if (failure.status === 409) {
                        const query = new URLSearchParams({ search: name });
                        const existing = (await apiRequest<ListItem[]>(`/api/${list}?${query}`).catch(() => null))?.data.find(
                            (item) => item.name === name,
                        );
                        if (existing) {
                            pick(existing);
                            return;
                        }
                    }
                    setCreateError(errorMessage(failure));
                },
            },
        );
    };

    const choose = (option: Option) => {
        if (option.kind === 'match') pick(option.item);
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
                const fallback = exact && !exclude.includes(exact.name) ? ({ kind: 'match', item: exact } as Option) : undefined;
                const option = showList ? (options[active] ?? fallback) : undefined;
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
        if (!picked && exact && !exclude.includes(exact.name) && !onCreate) pick(exact);
    };

    const describedBy = [error ? errorId : null, createError ? `${errorId}-create` : null].filter(Boolean).join(' ');

    return (
        <div className={styles.picker}>
            <input
                className={styles.input}
                role="combobox"
                aria-label={label}
                aria-expanded={showList}
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={showList && active >= 0 ? optionId(active) : undefined}
                aria-invalid={error ? true : undefined}
                aria-describedby={describedBy || undefined}
                placeholder={placeholder}
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
            <ul id={listId} role="listbox" aria-label={config.matching} className={styles.options} hidden={!showList}>
                {showList &&
                    options.map((option, index) => (
                        <li
                            key={option.kind === 'match' ? option.item.id : 'create'}
                            id={optionId(index)}
                            role="option"
                            aria-selected={index === active}
                            className={`${styles.option} ${option.kind === 'create' ? styles.createOption : ''}`}
                            // Keep focus in the box, so picking doesn't count as leaving it
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => choose(option)}
                        >
                            {option.kind === 'match' ? (
                                (renderItem?.(option.item) ?? option.item.name)
                            ) : (
                                <>
                                    <PlusIcon size={16} />
                                    Create {config.noun} “{option.name}”
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
            {newHint && picked?.id === null && picked.name === typed && <p className={styles.hint}>{newHint}</p>}
        </div>
    );
}
