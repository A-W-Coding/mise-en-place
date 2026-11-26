/**
 * @module web/src/pages/PhotosPage
 * `/recipes/:id/photos`: a recipe's photos (3b, as the wireframes have it).
 * The recipe page's main photo opens it.
 *
 * - **Add photo** opens the phone's own chooser, which offers its camera or
 *   its photos. Several can be chosen at once; they upload one after another,
 *   each shown in the grid as it goes. The rules sit beside the button: JPEG,
 *   PNG or WebP, up to 15 MB, and the location removed. A file over 15 MB is
 *   refused here, before it's sent.
 * - The grid is in upload order, the main photo marked. Each photo's ⋮ menu
 *   has Make main photo, View full size and Delete photo…, which asks first.
 * - A refused file is named in its message ("party.gif wasn't added. Only
 *   JPEG, PNG and WebP images are accepted."), and so is the limit of 10.
 * - Photos need the Pi: offline, Add photo is disabled and says so. A recipe
 *   that hasn't uploaded yet has no photos until it has.
 */

import { useRef, useState, type ChangeEvent } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError } from '../api/client';
import { onlineOnlyMessage } from '../api/errorMessage';
import { useDeletePhoto, useSetMainPhoto, useUploadPhoto } from '../api/mutations';
import { useRecipe } from '../api/queries';
import type { RecipeImage } from '../api/types';
import { BackLink } from '../components/BackLink';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ErrorBanner } from '../components/ErrorBanner';
import { CameraIcon } from '../components/Icons';
import { Menu } from '../components/Menu';
import { useDocumentTitle } from '../components/useDocumentTitle';
import { MAX_PHOTO_BYTES, MAX_PHOTOS, thumbUrl } from '../images/media';
import { Photo } from '../images/Photo';
import { PhotoViewer } from '../images/PhotoViewer';
import { useWaitingChanges } from '../offline/waiting';
import page from '../components/Page.module.css';
import styles from '../images/Photos.module.css';

const FULL_MESSAGE = 'This recipe has 10 photos, the most it can have. Delete one to add another.';
const OFFLINE_MESSAGE = 'Adding a photo needs a connection to the server. Check Tailscale is connected, then try again.';

/** One file on its way up, shown in the grid until it arrives. */
interface Upload {
    key: number;
    name: string;
}

let nextUpload = 0;

/** What to say when a file couldn't be added. */
function refusal(name: string, error: unknown): string {
    if (error instanceof ApiError && error.isNetworkError) return `${name} wasn't added. ${OFFLINE_MESSAGE}`;
    if (error instanceof ApiError && error.status === 409) return FULL_MESSAGE;
    const reason = error instanceof Error ? error.message : String(error);
    return `${name} wasn't added. ${reason}`;
}

export function PhotosPage() {
    const { id = '' } = useParams();
    const { data, error, isPending, refetch } = useRecipe(id);
    const change = useWaitingChanges().changes.find((candidate) => candidate.recipeId === id);
    const recipe = data?.data;
    useDocumentTitle(recipe ? `Photos · ${recipe.name}` : 'Photos');

    const upload = useUploadPhoto(id);
    const setMain = useSetMainPhoto(id);
    const deletion = useDeletePhoto(id);
    const input = useRef<HTMLInputElement>(null);
    const [uploads, setUploads] = useState<Upload[]>([]);
    const [messages, setMessages] = useState<string[]>([]);
    const [viewing, setViewing] = useState<RecipeImage | null>(null);
    const [deleting, setDeleting] = useState<RecipeImage | null>(null);
    const [deleteError, setDeleteError] = useState<string | null>(null);

    // A new recipe kept on this device hasn't reached the Pi yet, so it can't have photos
    const notUploaded = change?.kind === 'create' && (error?.status === 404 || (!recipe && !isPending));
    if (notUploaded) {
        return (
            <div className={styles.page}>
                <BackLink to={`/recipes/${id}`}>{change.body.name}</BackLink>
                <h1 className={styles.heading}>Photos</h1>
                <p className={page.noticeText}>Add photos once it's uploaded: this recipe is waiting on this device to reach the server.</p>
            </div>
        );
    }

    if (!recipe) {
        return (
            <div className={styles.page}>
                <BackLink to={`/recipes/${id}`}>Recipe</BackLink>
                <h1 className={styles.heading}>Photos</h1>
                {error?.status === 404 ? (
                    <div className={page.notice}>
                        <p className={page.noticeTitle}>This recipe was deleted</p>
                        <Link to="/" className={page.textButton}>
                            Back to recipes
                        </Link>
                    </div>
                ) : error ? (
                    <ErrorBanner error={error} onRetry={() => void refetch()} />
                ) : (
                    <p role="status" className={page.status}>
                        Loading photos…
                    </p>
                )}
            </div>
        );
    }

    const images = recipe.images;
    // Read from the copy: the Pi can't be reached, and photos need it
    const offline = data.fromCopy === true;
    const full = images.length + uploads.length >= MAX_PHOTOS;
    const label = (image: RecipeImage) => `Photo ${images.indexOf(image) + 1} of ${recipe.name}`;

    const addFiles = async (event: ChangeEvent<HTMLInputElement>) => {
        const chosen = Array.from(event.target.files ?? []);
        // Cleared, so choosing the same file again still counts as a change
        event.target.value = '';
        const notes: string[] = [];
        const room = Math.max(0, MAX_PHOTOS - images.length - uploads.length);
        const fitting = chosen.slice(0, room);
        const left = chosen.slice(room);
        if (left.length > 0) {
            notes.push(`Only ${room === 1 ? '1 more photo fits' : `${room} more photos fit`}, so ${left.map((file) => file.name).join(', ')} ${left.length === 1 ? "wasn't" : "weren't"} added.`);
        }
        const sending: (Upload & { file: File })[] = [];
        for (const file of fitting) {
            if (file.size > MAX_PHOTO_BYTES) notes.push(`${file.name} wasn't added. Images can be at most 15 MB.`);
            else sending.push({ key: (nextUpload += 1), name: file.name, file });
        }
        setMessages(notes);
        setUploads((current) => [...current, ...sending]);
        // One at a time, to spare the Pi: each is re-encoded as it arrives
        for (const item of sending) {
            try {
                await upload.mutateAsync(item.file);
            } catch (failure) {
                setMessages((current) => [...current, refusal(item.name, failure)]);
            } finally {
                setUploads((current) => current.filter((pending) => pending.key !== item.key));
            }
        }
    };

    const makeMain = (image: RecipeImage) => {
        setMessages([]);
        setMain.mutate(image.id, {
            onError: (failure) => setMessages([onlineOnlyMessage(failure, 'Changing the main photo')]),
        });
    };

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
                // Already gone: the recipe refreshes without it
                if (failure.status === 404) closeDelete();
                else setDeleteError(onlineOnlyMessage(failure, 'Deleting a photo'));
            },
        });
    };

    return (
        <div className={styles.page}>
            <BackLink to={`/recipes/${id}`}>{recipe.name}</BackLink>
            <div className={styles.headingRow}>
                <h1 className={styles.heading}>Photos</h1>
                <span className={styles.count}>
                    {images.length} of {MAX_PHOTOS}
                </span>
            </div>

            <div className={styles.add}>
                <input
                    ref={input}
                    id="add-photo"
                    type="file"
                    // Specific types, so a phone offers its camera and photos, and an iPhone sends JPEG rather than HEIC
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    className={styles.fileInput}
                    disabled={offline || full}
                    aria-describedby="add-photo-rules"
                    onChange={(event) => void addFiles(event)}
                />
                <label htmlFor="add-photo" className={styles.addButton} aria-disabled={offline || full || undefined}>
                    <CameraIcon size={20} />
                    Add photo
                </label>
                <p id="add-photo-rules" className={styles.hint}>
                    {offline
                        ? OFFLINE_MESSAGE
                        : full && uploads.length === 0
                          ? FULL_MESSAGE
                          : 'Take one or pick from your photos. JPEG, PNG or WebP, up to 15 MB. Location and other details are removed.'}
                </p>
            </div>

            {messages.length > 0 && (
                <div role="alert" className={styles.messages}>
                    {messages.map((message) => (
                        <p key={message} className={styles.message}>
                            {message}
                        </p>
                    ))}
                    <button type="button" className={styles.dismiss} onClick={() => setMessages([])}>
                        Dismiss
                    </button>
                </div>
            )}

            {images.length === 0 && uploads.length === 0 ? (
                <p className={page.noticeText}>No photos yet. The first one you add becomes the main photo, at the top of the recipe.</p>
            ) : (
                <ul aria-label="Photos" className={styles.grid}>
                    {images.map((image) => {
                        const main = image.id === recipe.primaryImageId;
                        return (
                            <li key={image.id} className={styles.tile}>
                                <button type="button" className={styles.tileButton} aria-label={`View ${label(image)}`} onClick={() => setViewing(image)}>
                                    <Photo src={thumbUrl(image.id)} alt="" className={styles.tileImage} />
                                </button>
                                {main && <span className={styles.mainBadge}>Main</span>}
                                <div className={styles.tileMenu}>
                                    <Menu
                                        label={`Options for ${label(image)}`}
                                        buttonClassName={styles.tileMenuButton}
                                        items={[
                                            {
                                                label: 'Make main photo',
                                                disabled: main || offline,
                                                hint: main ? 'It is the main photo' : offline ? 'Needs a connection' : undefined,
                                                onSelect: () => makeMain(image),
                                            },
                                            { label: 'View full size', onSelect: () => setViewing(image) },
                                            {
                                                label: 'Delete photo…',
                                                danger: true,
                                                disabled: offline,
                                                hint: offline ? 'Needs a connection' : undefined,
                                                onSelect: () => setDeleting(image),
                                            },
                                        ]}
                                    />
                                </div>
                            </li>
                        );
                    })}
                    {uploads.map((pending) => (
                        <li key={pending.key} className={`${styles.tile} ${styles.uploading}`}>
                            <span role="status" className={styles.uploadingText}>
                                Uploading {pending.name}
                                <span className={styles.progress} aria-hidden="true" />
                            </span>
                        </li>
                    ))}
                </ul>
            )}

            <p className={styles.hint}>In the order they were added. The main photo heads the recipe page, and its thumbnail is the list's.</p>

            <PhotoViewer imageId={viewing?.id ?? null} label={viewing ? label(viewing) : ''} onClose={() => setViewing(null)} />

            <ConfirmDialog
                open={deleting !== null}
                title="Delete this photo?"
                confirmLabel="Delete photo"
                tone="danger"
                busy={deletion.isPending}
                error={deleteError}
                onConfirm={confirmDelete}
                onCancel={closeDelete}
            >
                <p>
                    This can't be undone.
                    {deleting?.id === recipe.primaryImageId && images.length > 1 && ' The next photo becomes the main one.'}
                </p>
            </ConfirmDialog>
        </div>
    );
}
