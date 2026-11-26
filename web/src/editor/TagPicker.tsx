/**
 * @module web/src/editor/TagPicker
 * A recipe's tags in the editor (3b, as the wireframes have it), just under
 * its name: the tags it has, as pills in its order, each with a × to take it
 * off; then a box to add one, which searches the shared tags and offers to
 * create a missing one.
 *
 * A new tag needs a colour first: a panel offers ten presets or any colour,
 * with a preview. Online the tag is created there and then; offline it's
 * kept by name and colour, and created when the recipe reaches the server
 * (or the existing one used, if it was made elsewhere meanwhile).
 */

import { useState } from 'react';
import { errorMessage } from '../api/errorMessage';
import { apiRequest } from '../api/client';
import { useCreateShared } from '../api/mutations';
import type { Tag } from '../api/types';
import { ColourChooser } from '../components/ColourChooser';
import { CloseIcon } from '../components/Icons';
import { TagPill } from '../components/TagPill';
import { tagLabel, TAG_PRESETS } from '../tags/colour';
import { TAGS_ERROR, type DraftAction, type DraftErrors, type PickedTag } from './draft';
import { SharedListPicker } from './SharedListPicker';
import styles from './Editor.module.css';

interface TagPickerProps {
    tags: PickedTag[];
    errors: DraftErrors;
    dispatch: (action: DraftAction) => void;
}

/** A preset the recipe's tags don't use yet, so a new tag stands out from them. */
function freshColour(tags: PickedTag[]): string {
    const used = new Set(tags.map((tag) => tag.color));
    return (TAG_PRESETS.find((preset) => !used.has(preset.hex)) ?? TAG_PRESETS[0]!).hex;
}

export function TagPicker({ tags, errors, dispatch }: TagPickerProps) {
    const [text, setText] = useState('');
    // A new tag, while its colour is chosen
    const [creating, setCreating] = useState<string | null>(null);
    const [colour, setColour] = useState(TAG_PRESETS[0]!.hex);
    const [createError, setCreateError] = useState<string | null>(null);
    const create = useCreateShared<Tag>('tags');
    const error = errors[TAGS_ERROR];

    const add = (tag: PickedTag) => {
        dispatch({ type: 'addTag', tag });
        setText('');
        setCreating(null);
        setCreateError(null);
    };

    const addNew = (name: string) => {
        create.mutate(
            { name, color: colour },
            {
                onSuccess: (result) => add({ id: result.data.id, name: result.data.name, color: result.data.color }),
                onError: async (failure) => {
                    // Offline: it's created when the recipe reaches the server
                    if (failure.isNetworkError) {
                        add({ id: null, name, color: colour });
                        return;
                    }
                    // Made elsewhere a moment ago: use that one, with its own colour
                    if (failure.status === 409) {
                        const found = await apiRequest<Tag[]>(`/api/tags?${new URLSearchParams({ search: name })}`).catch(() => null);
                        const existing = found?.data.find((tag) => tag.name === name);
                        if (existing) {
                            add({ id: existing.id, name: existing.name, color: existing.color });
                            return;
                        }
                    }
                    setCreateError(errorMessage(failure));
                },
            },
        );
    };

    return (
        <div className={`${styles.field} ${styles.wide}`}>
            <span className={styles.label} id="tags-label">
                Tags
            </span>
            {tags.length > 0 && (
                <ul aria-labelledby="tags-label" className={styles.tagPills}>
                    {tags.map((tag) => (
                        <li key={tag.name}>
                            <TagPill name={tag.name} color={tag.color}>
                                <button
                                    type="button"
                                    className={styles.removeTag}
                                    aria-label={`Remove tag ${tagLabel(tag.name)}`}
                                    onClick={() => dispatch({ type: 'removeTag', name: tag.name })}
                                >
                                    <CloseIcon size={14} />
                                </button>
                            </TagPill>
                        </li>
                    ))}
                </ul>
            )}
            <div className={styles.tagBox}>
                <SharedListPicker
                    list="tags"
                    label="Add a tag"
                    placeholder="Add a tag, like weeknight"
                    text={text}
                    picked={null}
                    exclude={tags.map((tag) => tag.name)}
                    error={error}
                    errorId="tags-error"
                    onTextChange={setText}
                    onPick={(item) => add({ id: item.id, name: item.name, color: item.color ?? null })}
                    onCreate={(name) => {
                        setCreating(name);
                        setColour(freshColour(tags));
                        setCreateError(null);
                    }}
                    renderItem={(item) => <TagPill name={item.name} color={item.color ?? null} size="small" />}
                />
            </div>
            {error && (
                <p id="tags-error" className={styles.error}>
                    {error}
                </p>
            )}
            {creating !== null && (
                <section aria-label={`Colour for the new tag ${tagLabel(creating)}`} className={styles.newTag}>
                    <h3 className={styles.newTagTitle}>Colour for the new tag</h3>
                    <ColourChooser name={creating} value={colour} onChange={setColour} />
                    {createError && <p className={styles.error}>{createError}</p>}
                    <div className={styles.timerActions}>
                        <span className={styles.spacer} />
                        <button type="button" className={styles.secondaryButton} onClick={() => setCreating(null)}>
                            Cancel
                        </button>
                        <button type="button" className={styles.primaryButton} disabled={create.isPending} onClick={() => addNew(creating)}>
                            Add tag
                        </button>
                    </div>
                </section>
            )}
            <p className={styles.hint}>In this order on the recipe; the list shows the first two.</p>
        </div>
    );
}
