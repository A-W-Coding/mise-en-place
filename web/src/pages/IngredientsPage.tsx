/**
 * @module web/src/pages/IngredientsPage
 * `/options/ingredients`, and from 3b `/options/equipment`: a shared list,
 * searchable, loading more as you scroll, with each entry's ⋮ menu offering
 * Rename and Delete. Equipment is managed exactly like ingredients, so one
 * page serves both, with its words for each.
 *
 * Every recipe draws from these lists, so a rename shows in every recipe
 * using it. The API refuses a name that's taken (409) and a delete while a
 * recipe still uses the entry (409), and the page says which. Both need a
 * connection, and say so offline (3c).
 */

import { useState, type FormEvent } from 'react';
import type { ApiError } from '../api/client';
import { onlineOnlyMessage } from '../api/errorMessage';
import { useDeleteShared, useUpdateShared } from '../api/mutations';
import { useEquipmentList, useIngredientList } from '../api/queries';
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

/** An entry on a shared list. */
interface Entry {
    id: string;
    name: string;
}

/** Each list's words: its title, one entry, several, and the hint when it's empty. */
const WORDS = {
    ingredients: { title: 'Ingredients', one: 'ingredient', many: 'ingredients', empty: "They're added as you write recipes." },
    equipment: { title: 'Equipment', one: 'item', many: 'items', empty: "It's added as you write recipes." },
} as const;

type Kind = keyof typeof WORDS;

function countText(kind: Kind, total: number, searching: boolean): string {
    if (searching) return total === 1 ? '1 match' : `${total} matches`;
    return total === 1 ? `1 ${WORDS[kind].one}` : `${total} ${WORDS[kind].many}`;
}

export function IngredientsPage() {
    return <SharedListPage kind="ingredients" list={useIngredientList} />;
}

/** `/options/equipment` (3b): the shared equipment list, managed like ingredients. */
export function EquipmentPage() {
    return <SharedListPage kind="equipment" list={useEquipmentList} />;
}

interface SharedListPageProps {
    kind: Kind;
    list: (search: string) => ReturnType<typeof useIngredientList> | ReturnType<typeof useEquipmentList>;
}

function SharedListPage({ kind, list: useList }: SharedListPageProps) {
    const words = WORDS[kind];
    useDocumentTitle(words.title);
    const { text, setText, search, clear } = useSearchQuery();
    const list = useList(search);
    const { items, total, error, isPending, isPlaceholderData, isFetchNextPageError } = list;

    const [renaming, setRenaming] = useState<string | null>(null);
    const [deleting, setDeleting] = useState<Entry | null>(null);
    const [deleteError, setDeleteError] = useState<string | null>(null);
    // Shown at the top after a delete the API refused
    const [refused, setRefused] = useState<string | null>(null);
    const deletion = useDeleteShared(kind);

    const closeDelete = () => {
        setDeleting(null);
        setDeleteError(null);
        deletion.reset();
    };

    const confirmDelete = () => {
        if (!deleting) return;
        const entry = deleting;
        deletion.mutate(entry.id, {
            onSuccess: closeDelete,
            onError: (failure) => {
                if (failure.status === 409) {
                    closeDelete();
                    setRefused(`Can't delete “${entry.name}”: a recipe still uses it.`);
                } else if (failure.status === 404) {
                    // Already gone: the list refreshes without it
                    closeDelete();
                    void list.refetch();
                } else {
                    setDeleteError(onlineOnlyMessage(failure, `Deleting ${article(words.one)}`));
                }
            },
        });
    };

    return (
        <div className={styles.page}>
            <BackLink to="/options">Options</BackLink>
            <h1 className={styles.heading}>{words.title}</h1>
            <SearchBox label={`Search ${words.title.toLowerCase()}`} value={text} onChange={setText} />

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
                    Loading {words.title.toLowerCase()}…
                </p>
            )}

            {!isPending && !error && items.length === 0 && (
                <div className={page.notice}>
                    {search ? (
                        <>
                            <p className={page.noticeTitle}>
                                No {words.many} match “{search}”
                            </p>
                            <button type="button" className={page.textButton} onClick={clear}>
                                Clear search
                            </button>
                        </>
                    ) : (
                        <>
                            <p className={page.noticeTitle}>No {words.title.toLowerCase()} yet</p>
                            <p className={page.noticeText}>{words.empty}</p>
                        </>
                    )}
                </div>
            )}

            {items.length > 0 && (
                <>
                    {total !== null && <p className={page.count}>{countText(kind, total, search !== '')}</p>}
                    <ul aria-label={words.title} aria-busy={isPlaceholderData} className={styles.list}>
                        {(items as Entry[]).map((entry) =>
                            renaming === entry.id ? (
                                <RenameRow key={entry.id} kind={kind} entry={entry} onDone={() => setRenaming(null)} />
                            ) : (
                                <li key={entry.id} className={styles.row}>
                                    <span className={styles.name}>{entry.name}</span>
                                    <Menu
                                        label={`More options for ${entry.name}`}
                                        items={[
                                            { label: 'Rename', onSelect: () => setRenaming(entry.id) },
                                            {
                                                label: 'Delete…',
                                                danger: true,
                                                onSelect: () => {
                                                    setRefused(null);
                                                    setDeleting(entry);
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
                        loadingText={`Loading more ${words.title.toLowerCase()}…`}
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
                <p>
                    This can't be undone. {capitalise(article(words.one))} a recipe still uses can't be deleted.
                </p>
            </ConfirmDialog>
        </div>
    );
}

/** "an ingredient", "an item". */
function article(word: string): string {
    return `${/^[aeiou]/.test(word) ? 'an' : 'a'} ${word}`;
}

function capitalise(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The message for a refused rename: a taken name gets a clearer one than the API's. */
function renameError(kind: Kind, failure: ApiError, name: string): string {
    if (failure.status === 409) return `Another ${WORDS[kind].one} is already called “${name}”.`;
    return failure.fields.name ?? onlineOnlyMessage(failure, `Renaming ${article(WORDS[kind].one)}`);
}

/** A row turned into a small form: the new name, Cancel and Save. Escape cancels. */
function RenameRow({ kind, entry, onDone }: { kind: Kind; entry: Entry; onDone: () => void }) {
    const [name, setName] = useState(entry.name);
    const [error, setError] = useState<string | null>(null);
    const rename = useUpdateShared(kind);
    const inputId = `rename-${entry.id}`;

    const submit = (event: FormEvent) => {
        event.preventDefault();
        const trimmed = name.trim().toLowerCase();
        if (trimmed === '') {
            setError(`Give the ${WORDS[kind].one} a name.`);
            return;
        }
        if (trimmed === entry.name) {
            onDone();
            return;
        }
        rename.mutate(
            { id: entry.id, name: trimmed },
            { onSuccess: onDone, onError: (failure) => setError(renameError(kind, failure, trimmed)) },
        );
    };

    return (
        <li className={styles.renameRow}>
            <form className={styles.renameForm} onSubmit={submit} noValidate>
                <label htmlFor={inputId} className={styles.renameLabel}>
                    Rename “{entry.name}”
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
