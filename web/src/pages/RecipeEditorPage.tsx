/**
 * @module web/src/pages/RecipeEditorPage
 * `/recipes/new` and `/recipes/:id/edit`: the recipe editor (technical spec §3.4).
 *
 * - Name, description, servings and times, then the ingredient lines, then
 *   the method. The Ingredients and Method sections collapse, to jump between
 *   them on a phone.
 * - Problems show next to their boxes, whether this page finds them or the
 *   API does (its `fields`), and focus moves to the first one.
 * - Saving an edit sends the ETag of the version that was opened. If the
 *   recipe changed elsewhere since, the API answers 412 and a dialog offers
 *   to reload it (F3).
 * - Leaving with unsaved changes asks first, and so does closing the tab.
 * - Offline (3c, D15): a recipe opens from the offline copy, with the ETag
 *   the snapshot gave it. Save tries the Pi first, and if it can't be
 *   reached, keeps the change on the device to upload by itself later; the
 *   editor closes as after any save. A recipe with a change waiting opens
 *   that version, with the ETag it started from.
 * - A new recipe's id is made here, on the device, online or off, so there's
 *   one way to create a recipe and a retried upload can't create it twice.
 * - A waiting change the API refused (400) opens with the API's messages
 *   beside their fields, and saving it again uploads it (Step 18).
 * - The method is sections of steps (3b, as the wireframes have it): a card
 *   per section, a box per step, and a Timer button on each step that opens
 *   a sheet to set it. Removing a section asks first when it has steps or
 *   lines. Once the method has sections of its own, each ingredient line's
 *   ⋮ menu puts it in one, and the lines show grouped under their sections.
 * - Tags sit just under the name, and Equipment is a section of its own
 *   after the ingredients (3b). A new tag or item made offline is created
 *   when the recipe reaches the server.
 */

import { useEffect, useReducer, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useBlocker, useLocation, useNavigate, useParams } from 'react-router';
import { errorMessage } from '../api/errorMessage';
import { useSaveRecipe } from '../api/mutations';
import { useRecipe } from '../api/queries';
import type { ApiError } from '../api/client';
import { getOfflineCopyState } from '../offline/copy';
import { useWaitingChanges, waitingChangeFor, type ChangeProblem } from '../offline/waiting';
import type { FieldErrors } from '../api/client';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DeleteRecipeDialog } from '../components/DeleteRecipeDialog';
import { ErrorBanner } from '../components/ErrorBanner';
import { PlusIcon } from '../components/Icons';
import { useDocumentTitle } from '../components/useDocumentTitle';
import {
    buildRecipeBody,
    draftFromBody,
    draftFromRecipe,
    draftKeys,
    draftReducer,
    hasNamedSections,
    isDirty,
    lineErrorKey,
    lineGroups,
    mapServerErrors,
    newDraft,
    readAmount,
    sectionTitle,
    type BodyKeys,
    type DraftErrors,
    type EquipmentDraft,
    type LineDraft,
    type RecipeDraft,
    type SectionDraft,
} from '../editor/draft';
import { EquipmentRow } from '../editor/EquipmentRow';
import { LineRow } from '../editor/LineRow';
import { MethodSection } from '../editor/MethodSection';
import { StepTimerSheet, type TimerTarget } from '../editor/StepTimerSheet';
import { TagPicker } from '../editor/TagPicker';
import page from '../components/Page.module.css';
import styles from '../editor/Editor.module.css';

export function RecipeEditorPage() {
    const { id } = useParams();
    return id ? <EditRecipe key={id} id={id} /> : <NewRecipe />;
}

/** What the form opened: fixed for its life, so later refreshes don't touch it. */
interface EditorStart {
    draft: RecipeDraft;
    kind: 'create' | 'edit';
    /** The ETag of the version opened, sent as `If-Match`. */
    etag: string | null;
    /** A version waiting on the device, rather than one from the server or the copy. */
    fromWaiting: boolean;
    /** Why that version couldn't upload, if it couldn't. */
    problem?: ChangeProblem | null;
}

/** The API's refusal (400), next to the boxes it's about where it can be. */
function refusalErrors(message: string, fields: FieldErrors, keys: BodyKeys): DraftErrors {
    if (Object.keys(fields).length > 0) return mapServerErrors(fields, keys);
    if (message === 'One or more ingredient IDs are invalid.') {
        return { form: 'An ingredient on this recipe was deleted elsewhere. Choose it again, then save.' };
    }
    if (message === 'One or more tag IDs are invalid.') {
        return { form: 'A tag on this recipe was deleted elsewhere. Remove it or choose it again, then save.' };
    }
    if (message === 'One or more equipment IDs are invalid.') {
        return { form: 'An item of equipment on this recipe was deleted elsewhere. Choose it again, then save.' };
    }
    return { form: message };
}

function NewRecipe() {
    const [start] = useState<EditorStart>(() => ({ draft: newDraft(), kind: 'create', etag: null, fromWaiting: false }));
    // Made on the device, online or off (see the module comment)
    const [id] = useState(() => crypto.randomUUID());
    return <RecipeEditor recipeId={id} start={start} />;
}

/** Load the recipe, then edit the version that arrived: a change waiting on the device, or the latest one. */
function EditRecipe({ id }: { id: string }) {
    const recipe = useRecipe(id);
    const waiting = useWaitingChanges();
    const [start, setStart] = useState<EditorStart | null>(null);
    // Bumped by "Reload recipe", which starts the form again from the latest version
    const [version, setVersion] = useState(0);

    // Not the copy's version standing in while the API is asked: if the copy is older,
    // the edit would meet a 412. A recipe from the copy needs its ETag to be edited
    const loaded =
        recipe.data && !recipe.isPlaceholderData && !(recipe.data.fromCopy && recipe.data.etag === null)
            ? recipe.data
            : undefined;
    if (start === null && waiting.status === 'ready') {
        const change = waiting.changes.find((candidate) => candidate.recipeId === id);
        if (change) {
            setStart({
                draft: draftFromBody(change.body),
                kind: change.kind,
                etag: change.etag,
                fromWaiting: true,
                problem: change.problem,
            });
        } else if (loaded) {
            setStart({ draft: draftFromRecipe(loaded.data), kind: 'edit', etag: loaded.etag, fromWaiting: false });
        }
    }

    if (start) {
        return (
            <RecipeEditor
                key={version}
                recipeId={id}
                start={start}
                onReload={async () => {
                    const { data } = await recipe.refetch();
                    if (data) setStart({ draft: draftFromRecipe(data.data), kind: 'edit', etag: data.etag, fromWaiting: false });
                    setVersion((value) => value + 1);
                }}
            />
        );
    }

    if (recipe.error?.status === 404) {
        return (
            <div className={page.notice}>
                <h1 className={page.noticeTitle}>This recipe was deleted</h1>
                <Link to="/" className={page.textButton}>
                    Back to recipes
                </Link>
            </div>
        );
    }

    return (
        <div className={styles.page}>
            <h1 className={styles.heading}>Edit recipe</h1>
            {recipe.error ? (
                <ErrorBanner error={recipe.error} onRetry={() => void recipe.refetch()} />
            ) : (
                <p role="status" className={page.status}>
                    Loading recipe…
                </p>
            )}
        </div>
    );
}

interface RecipeEditorProps {
    recipeId: string;
    start: EditorStart;
    onReload?: () => Promise<void>;
}

function RecipeEditor({ recipeId, start, onReload }: RecipeEditorProps) {
    // A brand-new form; a new recipe waiting on the device is already a recipe to edit
    const editing = start.kind === 'edit' || start.fromWaiting;
    const navigate = useNavigate();
    const location = useLocation();

    // What the form started from, and the version it's editing: fixed for this form's life
    const [initial] = useState(start.draft);
    const etag = start.etag;
    const [draft, dispatch] = useReducer(draftReducer, start.draft);
    // A refused change opens with the API's messages beside their boxes, the first one focused
    const refused = start.problem?.kind === 'refused' ? start.problem : null;
    const [errors, setErrors] = useState<DraftErrors>(() =>
        refused ? refusalErrors(refused.message, refused.fields, draftKeys(start.draft)) : {},
    );
    const [open, setOpen] = useState({ ingredients: true, equipment: true, method: true });
    const [conflict, setConflict] = useState(false);
    const [deleting, setDeleting] = useState(false);
    // The step whose timer is being set, and a section waiting for "Remove" to be confirmed
    const [timerFor, setTimerFor] = useState<TimerTarget | null>(null);
    const [removingSection, setRemovingSection] = useState<SectionDraft | null>(null);
    const [focusErrors, setFocusErrors] = useState(refused ? 1 : 0);
    const save = useSaveRecipe();
    const formRef = useRef<HTMLFormElement>(null);
    const addLineRef = useRef<HTMLButtonElement>(null);
    const addSectionRef = useRef<HTMLButtonElement>(null);
    const addEquipmentRef = useRef<HTMLButtonElement>(null);
    // Set just before leaving on purpose (after saving or deleting), so the unsaved-changes check lets it through
    const leaving = useRef(false);

    const title = editing ? 'Edit recipe' : 'New recipe';
    useDocumentTitle(editing ? `Edit ${initial.name}` : title);
    const dirty = isDirty(initial, draft);

    // Leaving within the app with unsaved changes asks first…
    const blocker = useBlocker(
        ({ currentLocation, nextLocation }) =>
            dirty && !leaving.current && currentLocation.pathname !== nextLocation.pathname,
    );
    // …and so does closing or reloading the tab, through the browser's own prompt
    useEffect(() => {
        if (!dirty) return;
        const warn = (event: BeforeUnloadEvent) => event.preventDefault();
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [dirty]);

    // After a failed save, open any collapsed section with a problem in it, and focus the first problem
    useEffect(() => {
        if (focusErrors === 0) return;
        formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    }, [focusErrors]);

    const showErrors = (found: DraftErrors) => {
        setErrors(found);
        const keys = Object.keys(found);
        setOpen((sections) => ({
            ingredients: sections.ingredients || keys.some((key) => key.startsWith('line:')),
            equipment: sections.equipment || keys.some((key) => key.startsWith('equipment:')),
            method: sections.method || keys.some((key) => key.startsWith('section:') || key.startsWith('step:')),
        }));
        setFocusErrors((count) => count + 1);
    };

    const leaveTo = (path: string) => {
        leaving.current = true;
        navigate(path, { replace: true });
    };

    const saveFailed = (failure: ApiError, keys: BodyKeys) => {
        if (failure.status === 412) {
            setConflict(true);
        } else if (failure.status === 404 && editing) {
            setErrors({ form: "This recipe was deleted on another device, so it can't be saved." });
        } else if (failure.status === 400) {
            showErrors(refusalErrors(failure.message, failure.fields, keys));
        } else {
            setErrors({ form: errorMessage(failure) });
        }
    };

    const onSubmit = (event: FormEvent) => {
        event.preventDefault();
        const result = buildRecipeBody(draft);
        if ('errors' in result) {
            showErrors(result.errors);
            return;
        }
        setErrors({});
        let { kind } = start;
        let sendEtag = etag;
        if (start.fromWaiting && !waitingChangeFor(recipeId)) {
            // It uploaded while the form was open: this saves over the version it became
            const uploaded = getOfflineCopyState().copy?.data.etags[recipeId];
            if (uploaded) {
                kind = 'edit';
                sendEtag = uploaded;
            }
        }
        // Uploaded or kept on the device, the editor closes the same way
        save.mutate(
            { recipeId, kind, body: result.body, etag: sendEtag },
            {
                onSuccess: () => leaveTo(`/recipes/${recipeId}`),
                onError: (failure) => saveFailed(failure, result),
            },
        );
    };

    const cancel = () => {
        // Back to wherever the editor was opened from; a fresh tab has nowhere to go back to
        if (location.key !== 'default') navigate(-1);
        else navigate(editing ? `/recipes/${recipeId}` : '/');
    };

    const checkAmount = (line: LineDraft) => {
        const key = lineErrorKey(line.key, 'amount');
        const amount = readAmount(line);
        setErrors((current) => {
            const next = { ...current };
            if ('error' in amount) next[key] = amount.error;
            else delete next[key];
            return next;
        });
    };

    const removeLine = (line: LineDraft) => {
        dispatch({ type: 'remove', key: line.key });
        addLineRef.current?.focus();
    };

    // Removing a section loses its steps and ungroups its lines, so that asks first
    const linesIn = (section: SectionDraft) => draft.lines.filter((line) => line.sectionKey === section.key).length;
    const stepsIn = (section: SectionDraft) => section.steps.filter((step) => step.text.trim() !== '').length;
    const removeSection = (section: SectionDraft) => {
        if (stepsIn(section) > 0 || linesIn(section) > 0) setRemovingSection(section);
        else {
            dispatch({ type: 'removeSection', key: section.key });
            addSectionRef.current?.focus();
        }
    };

    // Lines show under their sections once there are sections to put them in, and one is
    const sectioned = hasNamedSections(draft.sections);
    const groups = sectioned && draft.lines.some((line) => line.sectionKey) ? lineGroups(draft) : null;
    const lineRow = (line: LineDraft) => {
        const position = draft.lines.indexOf(line);
        const sameGroup = (other: LineDraft | undefined) =>
            other !== undefined && (other.sectionKey ?? null) === (line.sectionKey ?? null);
        return (
            <LineRow
                key={line.key}
                line={line}
                n={position + 1}
                canMoveUp={sameGroup(draft.lines[position - 1])}
                canMoveDown={sameGroup(draft.lines[position + 1])}
                sections={sectioned ? draft.sections : null}
                errors={errors}
                dispatch={dispatch}
                onAmountBlur={checkAmount}
                onRemove={removeLine}
            />
        );
    };

    const removeEquipment = (line: EquipmentDraft) => {
        dispatch({ type: 'removeEquipment', key: line.key });
        addEquipmentRef.current?.focus();
    };

    const setField = (field: Exclude<keyof RecipeDraft, 'lines' | 'sections' | 'tags' | 'equipment'>) => (value: string) =>
        dispatch({ type: 'field', field, value });

    const fieldErrors = Object.keys(errors).filter((key) => key !== 'form').length;

    return (
        <form ref={formRef} className={styles.page} onSubmit={onSubmit} noValidate>
            <div className={styles.toolbar}>
                <button type="button" className={styles.cancel} onClick={cancel}>
                    Cancel
                </button>
                <h1 className={styles.heading}>{title}</h1>
                <button type="submit" className={styles.save} disabled={save.isPending}>
                    {save.isPending ? 'Saving…' : 'Save'}
                </button>
            </div>

            {(errors.form || fieldErrors > 0) && (
                <div role="alert" className={styles.summary}>
                    {errors.form ?? (fieldErrors === 1 ? 'One thing needs a look before saving.' : `${fieldErrors} things need a look before saving.`)}
                </div>
            )}

            <div className={styles.fields}>
                <Field label="Name" error={errors.name} wide>
                    {(props) => (
                        <input {...props} value={draft.name} onChange={(event) => setField('name')(event.target.value)} />
                    )}
                </Field>
                <TagPicker tags={draft.tags} errors={errors} dispatch={dispatch} />
                <Field label="Description" error={errors.description} wide>
                    {(props) => (
                        <textarea
                            {...props}
                            rows={2}
                            value={draft.description}
                            onChange={(event) => setField('description')(event.target.value)}
                        />
                    )}
                </Field>
                <Field label="Serves" error={errors.servings}>
                    {(props) => (
                        <input
                            {...props}
                            inputMode="numeric"
                            value={draft.servings}
                            onChange={(event) => setField('servings')(event.target.value)}
                        />
                    )}
                </Field>
                <Field label="Prep (min)" error={errors.prepTime}>
                    {(props) => (
                        <input
                            {...props}
                            inputMode="numeric"
                            value={draft.prepTime}
                            onChange={(event) => setField('prepTime')(event.target.value)}
                        />
                    )}
                </Field>
                <Field label="Cook (min)" error={errors.cookTime}>
                    {(props) => (
                        <input
                            {...props}
                            inputMode="numeric"
                            value={draft.cookTime}
                            onChange={(event) => setField('cookTime')(event.target.value)}
                        />
                    )}
                </Field>
            </div>

            <Section
                id="ingredient-lines"
                title="Ingredients"
                count={draft.lines.length}
                open={open.ingredients}
                onToggle={() => setOpen((sections) => ({ ...sections, ingredients: !sections.ingredients }))}
            >
                <p className={styles.hint}>
                    Type the amount and unit together, like 100 g, 1½ tbsp or 2-3.
                    {sectioned && ' A line’s ⋮ menu puts it in a section.'}
                </p>
                {groups ? (
                    groups.map((group) => {
                        const name = group.section
                            ? sectionTitle(group.section, draft.sections.indexOf(group.section))
                            : 'No section';
                        return (
                            <div key={group.section?.key ?? 'none'} className={styles.sectionBody}>
                                <h3 className={styles.groupHeading}>{name}</h3>
                                <ol className={styles.lines} aria-label={`Ingredient lines: ${name}`}>
                                    {group.lines.map(lineRow)}
                                </ol>
                            </div>
                        );
                    })
                ) : (
                    <ol className={styles.lines} aria-label="Ingredient lines">
                        {draft.lines.map(lineRow)}
                    </ol>
                )}
                <button ref={addLineRef} type="button" className={styles.addLine} onClick={() => dispatch({ type: 'add' })}>
                    <PlusIcon size={18} />
                    Add ingredient
                </button>
            </Section>

            <Section
                id="equipment-lines"
                title="Equipment"
                count={draft.equipment.length}
                open={open.equipment}
                onToggle={() => setOpen((sections) => ({ ...sections, equipment: !sections.equipment }))}
            >
                <p className={styles.hint}>Shared with every recipe, like ingredients. Optional means the recipe works without it.</p>
                {draft.equipment.length > 0 && (
                    <ol className={styles.lines} aria-label="Equipment lines">
                        {draft.equipment.map((line, index) => (
                            <EquipmentRow
                                key={line.key}
                                line={line}
                                index={index}
                                count={draft.equipment.length}
                                errors={errors}
                                dispatch={dispatch}
                                onRemove={removeEquipment}
                            />
                        ))}
                    </ol>
                )}
                <button
                    ref={addEquipmentRef}
                    type="button"
                    className={styles.addLine}
                    onClick={() => dispatch({ type: 'addEquipment' })}
                >
                    <PlusIcon size={18} />
                    Add equipment
                </button>
            </Section>

            <Section
                id="method"
                title="Method"
                open={open.method}
                onToggle={() => setOpen((sections) => ({ ...sections, method: !sections.method }))}
            >
                <p className={styles.hint}>
                    Each step is its own box; Enter starts the next one. Timer sets one the recipe page starts with a tap.
                </p>
                <ol className={styles.methodSections} aria-label="Method sections">
                    {draft.sections.map((section, index) => (
                        <MethodSection
                            key={section.key}
                            section={section}
                            index={index}
                            count={draft.sections.length}
                            named={sectioned}
                            errors={errors}
                            dispatch={dispatch}
                            onTimer={setTimerFor}
                            onRemove={removeSection}
                        />
                    ))}
                </ol>
                <button
                    ref={addSectionRef}
                    type="button"
                    className={styles.addLine}
                    onClick={() => dispatch({ type: 'addSection' })}
                >
                    <PlusIcon size={18} />
                    Add section
                </button>
            </Section>

            {editing && (
                <div className={styles.dangerZone}>
                    <button type="button" className={styles.deleteRecipe} onClick={() => setDeleting(true)}>
                        Delete recipe
                    </button>
                </div>
            )}

            <ConfirmDialog
                open={blocker.state === 'blocked'}
                title="Leave without saving?"
                confirmLabel="Leave"
                cancelLabel="Keep editing"
                tone="dangerOutline"
                onConfirm={() => blocker.proceed?.()}
                onCancel={() => blocker.reset?.()}
            >
                <p>Your changes to {draft.name.trim() || 'this recipe'} will be lost.</p>
            </ConfirmDialog>

            <StepTimerSheet
                target={timerFor}
                onSet={(seconds) => {
                    if (timerFor) dispatch({ type: 'step', key: timerFor.key, patch: { timerSeconds: seconds } });
                    setTimerFor(null);
                }}
                onClose={() => setTimerFor(null)}
            />

            <ConfirmDialog
                open={removingSection !== null}
                title={`Remove ${removingSection ? sectionTitle(removingSection, draft.sections.indexOf(removingSection)) : 'this section'}?`}
                confirmLabel="Remove section"
                cancelLabel="Keep it"
                tone="dangerOutline"
                onConfirm={() => {
                    if (removingSection) dispatch({ type: 'removeSection', key: removingSection.key });
                    setRemovingSection(null);
                    addSectionRef.current?.focus();
                }}
                onCancel={() => setRemovingSection(null)}
            >
                {removingSection && <p>{removalSummary(stepsIn(removingSection), linesIn(removingSection))}</p>}
            </ConfirmDialog>

            <ConfirmDialog
                open={conflict}
                title="This recipe changed on another device"
                confirmLabel="Reload recipe"
                cancelLabel="Keep editing"
                onConfirm={() => {
                    setConflict(false);
                    void onReload?.();
                }}
                onCancel={() => setConflict(false)}
            >
                <p>Saving now would overwrite those changes. Reload to see the latest version; your edits here will be lost.</p>
            </ConfirmDialog>

            {editing && (
                <DeleteRecipeDialog
                    recipe={deleting ? { id: recipeId, name: initial.name } : null}
                    etag={etag}
                    onClose={() => setDeleting(false)}
                    onDeleted={() => leaveTo('/')}
                />
            )}
        </form>
    );
}

/** What removing a section does: "Its 4 steps go with it. Its 2 ingredient lines stay, in no section." */
function removalSummary(steps: number, lines: number): string {
    const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
    const parts: string[] = [];
    if (steps > 0) parts.push(`Its ${plural(steps, 'step')} ${steps === 1 ? 'goes' : 'go'} with it.`);
    if (lines > 0) parts.push(`Its ${plural(lines, 'ingredient line')} ${lines === 1 ? 'stays' : 'stay'}, in no section.`);
    return parts.join(' ');
}

interface FieldProps {
    label: string;
    /** The box's id, when its label isn't unique enough to make one. */
    id?: string;
    error?: string;
    /** Spans the whole row of fields. */
    wide?: boolean;
    /** A small, muted label. */
    quiet?: boolean;
    children: (props: {
        id: string;
        className: string;
        'aria-invalid'?: true;
        'aria-describedby'?: string;
    }) => ReactNode;
}

/** A labelled box with its error under it. */
function Field({ label, id: givenId, error, wide, quiet, children }: FieldProps) {
    const id = givenId ?? `field-${label.toLowerCase().replace(/\W+/g, '-')}`;
    return (
        <div className={`${styles.field} ${wide ? styles.wide : ''}`}>
            <label htmlFor={id} className={quiet ? styles.quietLabel : styles.label}>
                {label}
            </label>
            {children({
                id,
                className: styles.input,
                'aria-invalid': error ? true : undefined,
                'aria-describedby': error ? `${id}-error` : undefined,
            })}
            {error && (
                <p id={`${id}-error`} className={styles.error}>
                    {error}
                </p>
            )}
        </div>
    );
}

interface SectionProps {
    id: string;
    title: string;
    count?: number;
    open: boolean;
    onToggle: () => void;
    children: ReactNode;
}

/** A section whose heading opens and closes it. Closed content is hidden, not removed, so nothing typed is lost. */
function Section({ id, title, count, open, onToggle, children }: SectionProps) {
    return (
        <section className={styles.section} aria-labelledby={`${id}-heading`}>
            <h2 className={styles.sectionHeading} id={`${id}-heading`}>
                <button type="button" className={styles.sectionToggle} aria-expanded={open} aria-controls={id} onClick={onToggle}>
                    <span className={styles.sectionTitle}>
                        {title}
                        {count !== undefined && (
                            <>
                                {' '}
                                <span className={styles.sectionCount}>({count})</span>
                            </>
                        )}
                    </span>
                    <svg
                        className={open ? styles.chevronOpen : styles.chevron}
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                    >
                        <path d="M6 9l6 6 6-6" />
                    </svg>
                </button>
            </h2>
            <div id={id} className={styles.sectionBody} hidden={!open}>
                {children}
            </div>
        </section>
    );
}
