/**
 * @module web/src/pages/RecipeListPage
 * `/`: every recipe, searchable, loading more as you scroll (technical spec §3.4).
 *
 * Rows become tiles on a wider screen. Each row shows the recipe's main
 * photo as a thumbnail, or a plain plate when it has none, and its first two
 * tags as pills beside its name (3b); a tile shows the photo larger, across
 * its top.
 *
 * The list filters by one tag at a time (3b): a row of the tags, most used
 * first, under the search box, scrolling sideways on a phone and wrapping on
 * a wider screen. The tag is kept in the address (`?tag=<id>`), so Back and
 * a refresh keep it; it works together with search, and offline it filters
 * on the device.
 *
 * Changes waiting on the device (3c) show at once: new recipes in a "Waiting
 * to upload" list above the rest, searched on the device, and an edited
 * recipe's row with its new name and a tag.
 */

import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useAllTags, useRecipeList } from '../api/queries';
import type { RecipeSummary, Tag } from '../api/types';
import { CheckIcon } from '../components/Icons';
import { TagPill } from '../components/TagPill';
import { thumbUrl } from '../images/media';
import { Photo } from '../images/Photo';
import { DeleteRecipeDialog } from '../components/DeleteRecipeDialog';
import { ErrorBanner } from '../components/ErrorBanner';
import { PlusIcon } from '../components/Icons';
import { LoadMore } from '../components/LoadMore';
import { Menu } from '../components/Menu';
import { recipeMenuItems } from '../components/recipeMenu';
import { SearchBox } from '../components/SearchBox';
import { useDocumentTitle } from '../components/useDocumentTitle';
import { useSearchQuery, withParam } from '../components/useSearchQuery';
import { WaitingTag } from '../components/Waiting';
import { listMeta } from '../format';
import { tagLabel } from '../tags/colour';
import { matchesSearch } from '../offline/read';
import { recipeFromChange } from '../offline/upload';
import { useWaitingChanges, type WaitingChange } from '../offline/waiting';
import page from '../components/Page.module.css';
import styles from './RecipeListPage.module.css';

function countText(total: number, searching: boolean, tag: Tag | undefined): string {
    const count = searching ? (total === 1 ? '1 match' : `${total} matches`) : total === 1 ? '1 recipe' : `${total} recipes`;
    return tag ? `${count} tagged ${tagLabel(tag.name)}` : count;
}

export function RecipeListPage() {
    useDocumentTitle(null);
    const { text, setText, search, clear } = useSearchQuery();
    const [params, setParams] = useSearchParams();
    const tagId = params.get('tag') ?? '';
    const { tags } = useAllTags();
    const tag = tags.find((candidate) => candidate.id === tagId);
    const list = useRecipeList(search, tagId);
    const { items, total, error, isPending, isPlaceholderData, isFetchNextPageError } = list;
    // The recipe whose Delete was chosen, while its confirmation is open
    const [deleting, setDeleting] = useState<RecipeSummary | null>(null);
    // Where a recipe's back link returns to: this list, with this search and tag
    const query = new URLSearchParams();
    if (search) query.set('q', search);
    if (tagId) query.set('tag', tagId);
    const listUrl = query.size > 0 ? `/?${query}` : '/';
    const chooseTag = (id: string) => setParams((current) => withParam(current, 'tag', id), { replace: true });

    const { changes } = useWaitingChanges();
    const changeFor = new Map(changes.map((change) => [change.recipeId, change]));
    const listed = new Set(items.map((recipe) => recipe.id));
    const waitingNew = changes.filter(
        (change) =>
            change.kind === 'create' &&
            !listed.has(change.recipeId) &&
            (!search || matchesSearch(change.body.name, search)) &&
            (!tagId || change.body.tags.some((candidate) => candidate.tagId === tagId)),
    );

    const row = (recipe: RecipeSummary, change: WaitingChange | undefined) => {
        const shown = change ? recipeFromChange(change, recipe) : recipe;
        return (
            <li key={recipe.id} className={styles.row}>
                <Link to={`/recipes/${recipe.id}`} state={{ from: listUrl }} className={styles.rowLink}>
                    <Photo src={shown.primaryImageId && thumbUrl(shown.primaryImageId)} alt="" className={styles.thumb} />
                    <span className={styles.rowText}>
                        <span className={styles.nameLine}>
                            <span className={styles.name}>{shown.name}</span>
                            {/* The first two, in the recipe's own order */}
                            {shown.tags.slice(0, 2).map((line) => (
                                <TagPill key={line.tagId} name={line.tag.name} color={line.tag.color} size="small" />
                            ))}
                            {change && <WaitingTag change={change} />}
                        </span>
                        <span className={styles.meta}>{listMeta(shown)}</span>
                    </span>
                </Link>
                <Menu
                    label={`More options for ${shown.name}`}
                    items={recipeMenuItems(recipe.id, () => setDeleting(shown))}
                    buttonClassName={styles.rowMenu}
                />
            </li>
        );
    };

    const newRecipe = (
        <Link to="/recipes/new" className={page.primaryButton}>
            <PlusIcon size={18} />
            New recipe
        </Link>
    );

    return (
        <div className={styles.page}>
            <div className={styles.toolbar}>
                <h1 className={styles.heading}>Recipes</h1>
                <SearchBox label="Search recipes" value={text} onChange={setText} className={styles.search} />
                <div className={styles.newRecipe}>{newRecipe}</div>
            </div>

            {tags.length > 0 && (
                <div role="group" aria-label="Filter by tag" className={styles.tagFilter}>
                    {tags.map((candidate) => {
                        const chosen = candidate.id === tagId;
                        return (
                            <button
                                key={candidate.id}
                                type="button"
                                aria-pressed={chosen}
                                className={styles.tagChip}
                                onClick={() => chooseTag(chosen ? '' : candidate.id)}
                            >
                                {chosen && <CheckIcon size={14} />}
                                {tagLabel(candidate.name)}
                            </button>
                        );
                    })}
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
                    Loading recipes…
                </p>
            )}

            {waitingNew.length > 0 && (
                <section aria-labelledby="waiting-heading">
                    <h2 id="waiting-heading" className={page.count}>
                        Waiting to upload
                    </h2>
                    <ul aria-labelledby="waiting-heading" className={styles.list}>
                        {waitingNew.map((change) => row(recipeFromChange(change), change))}
                    </ul>
                </section>
            )}

            {!isPending && !error && items.length === 0 && waitingNew.length === 0 && tagId && !search && (
                <div className={page.notice}>
                    <p className={page.noticeTitle}>No recipes tagged {tag ? tagLabel(tag.name) : 'with that tag'}</p>
                    <button type="button" className={page.textButton} onClick={() => chooseTag('')}>
                        Show every recipe
                    </button>
                </div>
            )}

            {!isPending && !error && items.length === 0 && waitingNew.length === 0 && !search && !tagId && (
                <div className={page.notice}>
                    <p className={page.noticeTitle}>No recipes yet</p>
                    <p className={page.noticeText}>Add your first one and it will show up here.</p>
                    <div className={styles.noticeAction}>{newRecipe}</div>
                </div>
            )}

            {!isPending && !error && items.length === 0 && waitingNew.length === 0 && search && (
                <div className={page.notice}>
                    <p className={page.noticeTitle}>No recipes match “{search}”</p>
                    <button type="button" className={page.textButton} onClick={clear}>
                        Clear search
                    </button>
                </div>
            )}

            {items.length > 0 && (
                <>
                    {total !== null && (
                        <p className={page.count}>
                            {countText(total, search !== '', tag)}
                            {tagId && (
                                <>
                                    {' · '}
                                    <button type="button" className={styles.clearTag} onClick={() => chooseTag('')}>
                                        Clear
                                    </button>
                                </>
                            )}
                        </p>
                    )}
                    <ul aria-label="Recipes" aria-busy={isPlaceholderData} className={styles.list}>
                        {items.map((recipe) => row(recipe, changeFor.get(recipe.id)))}
                    </ul>
                    <LoadMore
                        hasNextPage={list.hasNextPage}
                        isFetchingNextPage={list.isFetchingNextPage}
                        failed={isFetchNextPageError}
                        fetchNextPage={() => void list.fetchNextPage()}
                        pageCount={list.data?.pages.length ?? 0}
                        loadingText="Loading more recipes…"
                    />
                </>
            )}

            {/* From the list there's no ETag to send: the confirmation, by name, is the check */}
            <DeleteRecipeDialog recipe={deleting} onClose={() => setDeleting(null)} onDeleted={() => setDeleting(null)} />
        </div>
    );
}
