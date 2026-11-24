/**
 * @module web/src/pages/IngredientsPage
 * `/options/ingredients`: the shared ingredient list, searchable, loading more
 * as you scroll, with each ingredient's ⋮ menu offering Rename and Delete.
 *
 * Every recipe draws from this one list, so a rename shows in every recipe
 * using it. The API refuses a name that's taken (409) and a delete while a
 * recipe still uses the ingredient (409), and the page says which. Both need
 * a connection, and say so offline (3c).
 */

import { useState, type FormEvent } from 'react';
import type { ApiError } from '../api/client';
import { onlineOnlyMessage } from '../api/errorMessage';
import { useDeleteIngredient, useRenameIngredient } from '../api/mutations';
import { useIngredientList } from '../api/queries';
import type { Ingredient } from '../api/types';
import { BackLink } from '../components/BackLink';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadMore } from '../components/LoadMore';
import { Menu } from '../components/Menu';
import { SearchBox } from '../components/SearchBox';
import { useDocumentTitle } from '../components/useDocumentTitle';
import { useSearchQuery } from '../components/useSearchQuery';
import page from '../components/Page.module.css';
import styles from './IngredientsPage.module.css';

function countText(total: number, searching: boolean): string {
    if (searching) return total === 1 ? '1 match' : `${total} matches`;
    return total === 1 ? '1 ingredient' : `${total} ingredients`;
}

export function IngredientsPage() {
    useDocumentTitle('Ingredients');
    const { text, setText, search, clear } = useSearchQuery();
    const list = useIngredientList(search);
    const { items, total, error, isPending, isPlaceholderData, isFetchNextPageError } = list;

    const [renaming, setRenaming] = useState<string | null>(null);
    const [deleting, setDeleting] = useState<Ingredient | null>(null);
    const [deleteError, setDeleteError] = useState<string | null>(null);
    // Shown at the top after a delete the API refused
    const [refused, setRefused] = useState<string | null>(null);
    const deletion = useDeleteIngredient();

    const closeDelete = () => {
        setDeleting(null);
        setDeleteError(null);
        deletion.reset();
    };

    const confirmDelete = () => {
        if (!deleting) return;
        const ingredient = deleting;
        deletion.mutate(ingredient.id, {
            onSuccess: closeDelete,
            onError: (failure) => {
                if (failure.status === 409) {
                    closeDelete();
                    setRefused(`Can't delete “${ingredient.name}”: a recipe still uses it.`);
                } else if (failure.status === 404) {
                    // Already gone: the list refreshes without it
                    closeDelete();
                    void list.refetch();
                } else {
                    setDeleteError(onlineOnlyMessage(failure, 'Deleting an ingredient'));
                }
            },
        });
    };

    return (
        <div className={styles.page}>
            <BackLink to="/options">Options</BackLink>
            <h1 className={styles.heading}>Ingredients</h1>
            <SearchBox label="Search ingredients" value={text} onChange={setText} />

            {refused && (
                <div role="alert" className={styles.refused}>
                    <span>{refused}</span>
                    <button type="button" className={styles.dismiss} onClick={() => setRefused(null)}>
                        Dismiss
                    </button>
                </div>
            )}

            {error && (
                <ErrorBanner
                    error={error}
                    onRetry={() => void (isFetchNextPageError ? list.fetchNextPage() : list.refetch())}
                />
            )}

            {isPending && (
                <p role="status" className={page.status}>
                    Loading ingredients…
                </p>
            )}

            {!isPending && !error && items.length === 0 && (
                <div className={page.notice}>
                    {search ? (
                        <>
                            <p className={page.noticeTitle}>No ingredients match “{search}”</p>
                            <button type="button" className={page.textButton} onClick={clear}>
                                Clear search
                            </button>
                        </>
                    ) : (
                        <>
                            <p className={page.noticeTitle}>No ingredients yet</p>
                            <p className={page.noticeText}>They're added as you write recipes.</p>
                        </>
                    )}
                </div>
            )}

            {items.length > 0 && (
                <>
                    {total !== null && <p className={page.count}>{countText(total, search !== '')}</p>}
                    <ul aria-label="Ingredients" aria-busy={isPlaceholderData} className={styles.list}>
                        {items.map((ingredient) =>
                            renaming === ingredient.id ? (
                                <RenameRow key={ingredient.id} ingredient={ingredient} onDone={() => setRenaming(null)} />
                            ) : (
                                <li key={ingredient.id} className={styles.row}>
                                    <span className={styles.name}>{ingredient.name}</span>
                                    <Menu
                                        label={`More options for ${ingredient.name}`}
                                        items={[
                                            { label: 'Rename', onSelect: () => setRenaming(ingredient.id) },
                                            {
                                                label: 'Delete…',
                                                danger: true,
                                                onSelect: () => {
                                                    setRefused(null);
                                                    setDeleting(ingredient);
                                                },
                                            },
                                        ]}
                                    />
                                </li>
                            ),
                        )}
                    </ul>
                    <LoadMore
                        hasNextPage={list.hasNextPage}
                        isFetchingNextPage={list.isFetchingNextPage}
                        failed={isFetchNextPageError}
                        fetchNextPage={() => void list.fetchNextPage()}
                        pageCount={list.data?.pages.length ?? 0}
                        loadingText="Loading more ingredients…"
                    />
                </>
            )}

            <ConfirmDialog
                open={deleting !== null}
                title={`Delete “${deleting?.name ?? ''}”?`}
                confirmLabel="Delete"
                tone="danger"
                busy={deletion.isPending}
                error={deleteError}
                onConfirm={confirmDelete}
                onCancel={closeDelete}
            >
                <p>This can't be undone. An ingredient a recipe still uses can't be deleted.</p>
            </ConfirmDialog>
        </div>
    );
}

/** The message for a refused rename: a taken name gets a clearer one than the API's. */
function renameError(failure: ApiError, name: string): string {
    if (failure.status === 409) return `Another ingredient is already called “${name}”.`;
    return failure.fields.name ?? onlineOnlyMessage(failure, 'Renaming an ingredient');
}

/** A row turned into a small form: the new name, Cancel and Save. Escape cancels. */
function RenameRow({ ingredient, onDone }: { ingredient: Ingredient; onDone: () => void }) {
    const [name, setName] = useState(ingredient.name);
    const [error, setError] = useState<string | null>(null);
    const rename = useRenameIngredient();
    const inputId = `rename-${ingredient.id}`;

    const submit = (event: FormEvent) => {
        event.preventDefault();
        const trimmed = name.trim().toLowerCase();
        if (trimmed === '') {
            setError('Give the ingredient a name.');
            return;
        }
        if (trimmed === ingredient.name) {
            onDone();
            return;
        }
        rename.mutate(
            { id: ingredient.id, name: trimmed },
            { onSuccess: onDone, onError: (failure) => setError(renameError(failure, trimmed)) },
        );
    };

    return (
        <li className={styles.renameRow}>
            <form className={styles.renameForm} onSubmit={submit} noValidate>
                <label htmlFor={inputId} className={styles.renameLabel}>
                    Rename “{ingredient.name}”
                </label>
                <input
                    id={inputId}
                    className={styles.renameInput}
                    value={name}
                    autoFocus
                    autoComplete="off"
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? `${inputId}-error` : undefined}
                    onChange={(event) => setName(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Escape') onDone();
                    }}
                />
                {error && (
                    <p id={`${inputId}-error`} className={styles.renameError}>
                        {error}
                    </p>
                )}
                <div className={styles.renameActions}>
                    <button type="button" className={styles.cancelButton} onClick={onDone}>
                        Cancel
                    </button>
                    <button type="submit" className={styles.saveButton} disabled={rename.isPending}>
                        Save
                    </button>
                </div>
            </form>
        </li>
    );
}
