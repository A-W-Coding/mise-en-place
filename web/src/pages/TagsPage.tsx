/**
 * @module web/src/pages/TagsPage
 * `/options/tags` (3b, as the wireframes have it): the shared tags, each as
 * its pill with how many recipes use it, searchable, loading more as you
 * scroll. Each tag's ⋮ menu offers Rename, Change colour (the same presets
 * and any colour as a new tag) and Delete…, which asks first and says how
 * many recipes it comes off. The recipes themselves stay.
 *
 * Every recipe shows a tag's name and colour, so a change shows on all of
 * them. A taken name is refused (409). All three need a connection, and say
 * so offline (3c).
 */

import { useState, type FormEvent } from 'react';
import type { ApiError } from '../api/client';
import { onlineOnlyMessage } from '../api/errorMessage';
import { useDeleteShared, useUpdateShared } from '../api/mutations';
import { useTagList } from '../api/queries';
import type { Tag } from '../api/types';
import { BackLink } from '../components/BackLink';
import { ColourChooser } from '../components/ColourChooser';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadMore } from '../components/LoadMore';
import { Menu } from '../components/Menu';
import { SearchBox } from '../components/SearchBox';
import { TagPill } from '../components/TagPill';
import { useDocumentTitle } from '../components/useDocumentTitle';
import { useSearchQuery } from '../components/useSearchQuery';
import { tagLabel, TAG_PRESETS } from '../tags/colour';
import page from '../components/Page.module.css';
import styles from './IngredientsPage.module.css';

function countText(total: number, searching: boolean): string {
    if (searching) return total === 1 ? '1 match' : `${total} matches`;
    return total === 1 ? '1 tag' : `${total} tags`;
}

function recipesText(count: number): string {
    return count === 1 ? '1 recipe' : `${count} recipes`;
}

/** What deleting a tag does, said before it's done. */
function deleteText(tag: Tag): string {
    const count = tag.recipeCount ?? 0;
    if (count === 0) return 'No recipe has it.';
    return `It comes off ${recipesText(count)}; the ${count === 1 ? 'recipe stays' : 'recipes stay'}.`;
}

export function TagsPage() {
    useDocumentTitle('Tags');
    const { text, setText, search, clear } = useSearchQuery();
    const list = useTagList(search);
    const { items, total, error, isPending, isPlaceholderData, isFetchNextPageError } = list;

    // The tag being renamed or recoloured, in its row
    const [editing, setEditing] = useState<{ id: string; what: 'name' | 'colour' } | null>(null);
    const [deleting, setDeleting] = useState<Tag | null>(null);
    const [deleteError, setDeleteError] = useState<string | null>(null);
    const deletion = useDeleteShared('tags');

    const closeDelete = () => {
        setDeleting(null);
        setDeleteError(null);
        deletion.reset();
    };

    const confirmDelete = () => {
        if (!deleting) return;
        deletion.mutate(deleting.id, {
            onSuccess: closeDelete,
            onError: (failure) => {
                if (failure.status === 404) {
                    // Already gone: the list refreshes without it
                    closeDelete();
                    void list.refetch();
                } else {
                    setDeleteError(onlineOnlyMessage(failure, 'Deleting a tag'));
                }
            },
        });
    };

    return (
        <div className={styles.page}>
            <BackLink to="/options">Options</BackLink>
            <h1 className={styles.heading}>Tags</h1>
            <p className={page.noticeText}>Shared by every recipe. Deleting a tag takes it off every recipe that has it; the recipes stay.</p>
            <SearchBox label="Search tags" value={text} onChange={setText} />

            {error && (
                <ErrorBanner
                    error={error}
                    onRetry={() => void (isFetchNextPageError ? list.fetchNextPage() : list.refetch())}
                />
            )}

            {isPending && (
                <p role="status" className={page.status}>
                    Loading tags…
                </p>
            )}

            {!isPending && !error && items.length === 0 && (
                <div className={page.notice}>
                    {search ? (
                        <>
                            <p className={page.noticeTitle}>No tags match “{search}”</p>
                            <button type="button" className={page.textButton} onClick={clear}>
                                Clear search
                            </button>
                        </>
                    ) : (
                        <>
                            <p className={page.noticeTitle}>No tags yet</p>
                            <p className={page.noticeText}>Add one to a recipe in its editor.</p>
                        </>
                    )}
                </div>
            )}

            {items.length > 0 && (
                <>
                    {total !== null && <p className={page.count}>{countText(total, search !== '')}</p>}
                    <ul aria-label="Tags" aria-busy={isPlaceholderData} className={styles.list}>
                        {items.map((tag) => {
                            if (editing?.id === tag.id && editing.what === 'name') {
                                return <RenameTag key={tag.id} tag={tag} onDone={() => setEditing(null)} />;
                            }
                            if (editing?.id === tag.id) {
                                return <RecolourTag key={tag.id} tag={tag} onDone={() => setEditing(null)} />;
                            }
                            return (
                                <li key={tag.id} className={styles.row}>
                                    <span className={styles.name}>
                                        <TagPill name={tag.name} color={tag.color} />
                                    </span>
                                    <span className={styles.count}>{recipesText(tag.recipeCount ?? 0)}</span>
                                    <Menu
                                        label={`More options for ${tagLabel(tag.name)}`}
                                        items={[
                                            { label: 'Rename', onSelect: () => setEditing({ id: tag.id, what: 'name' }) },
                                            { label: 'Change colour', onSelect: () => setEditing({ id: tag.id, what: 'colour' }) },
                                            { label: 'Delete…', danger: true, onSelect: () => setDeleting(tag) },
                                        ]}
                                    />
                                </li>
                            );
                        })}
                    </ul>
                    <LoadMore
                        hasNextPage={list.hasNextPage}
                        isFetchingNextPage={list.isFetchingNextPage}
                        failed={isFetchNextPageError}
                        fetchNextPage={() => void list.fetchNextPage()}
                        pageCount={list.data?.pages.length ?? 0}
                        loadingText="Loading more tags…"
                    />
                </>
            )}

            <ConfirmDialog
                open={deleting !== null}
                title={`Delete the tag ${deleting ? tagLabel(deleting.name) : ''}?`}
                confirmLabel="Delete"
                tone="danger"
                busy={deletion.isPending}
                error={deleteError}
                onConfirm={confirmDelete}
                onCancel={closeDelete}
            >
                {deleting && <p>{deleteText(deleting)}</p>}
            </ConfirmDialog>
        </div>
    );
}

/** The message for a refused change: a taken name gets a clearer one than the API's. */
function changeError(failure: ApiError, what: string, name?: string): string {
    if (failure.status === 409 && name) return `Another tag is already called “${name}”.`;
    return failure.fields.name ?? failure.fields.color ?? onlineOnlyMessage(failure, what);
}

/** A row turned into a small form: the new name, Cancel and Save. Escape cancels. */
function RenameTag({ tag, onDone }: { tag: Tag; onDone: () => void }) {
    const [name, setName] = useState(tag.name);
    const [error, setError] = useState<string | null>(null);
    const rename = useUpdateShared('tags');
    const inputId = `rename-${tag.id}`;

    const submit = (event: FormEvent) => {
        event.preventDefault();
        const trimmed = name.trim().toLowerCase();
        if (trimmed === '') {
            setError('Give the tag a name.');
            return;
        }
        if (trimmed === tag.name) {
            onDone();
            return;
        }
        rename.mutate({ id: tag.id, name: trimmed }, { onSuccess: onDone, onError: (failure) => setError(changeError(failure, 'Renaming a tag', trimmed)) });
    };

    return (
        <li className={styles.renameRow}>
            <form className={styles.renameForm} onSubmit={submit} noValidate>
                <label htmlFor={inputId} className={styles.renameLabel}>
                    Rename {tagLabel(tag.name)}
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

/** A row turned into the colour chooser, with Cancel and Save. */
function RecolourTag({ tag, onDone }: { tag: Tag; onDone: () => void }) {
    const [colour, setColour] = useState(tag.color ?? TAG_PRESETS[0]!.hex);
    const [error, setError] = useState<string | null>(null);
    const recolour = useUpdateShared('tags');

    const submit = (event: FormEvent) => {
        event.preventDefault();
        if (colour === tag.color) {
            onDone();
            return;
        }
        recolour.mutate({ id: tag.id, color: colour }, { onSuccess: onDone, onError: (failure) => setError(changeError(failure, 'Changing a colour')) });
    };

    return (
        <li className={styles.renameRow}>
            <form className={styles.renameForm} onSubmit={submit} noValidate aria-label={`Colour for ${tagLabel(tag.name)}`}>
                <ColourChooser name={tag.name} value={colour} onChange={setColour} />
                {error && <p className={styles.renameError}>{error}</p>}
                <div className={styles.renameActions}>
                    <button type="button" className={styles.cancelButton} onClick={onDone}>
                        Cancel
                    </button>
                    <button type="submit" className={styles.saveButton} disabled={recolour.isPending}>
                        Save
                    </button>
                </div>
            </form>
        </li>
    );
}
