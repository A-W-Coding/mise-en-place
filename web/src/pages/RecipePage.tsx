/**
 * @module web/src/pages/RecipePage
 * `/recipes/:id`: one recipe, laid out for reading while cooking.
 *
 * On a phone it's one column: name, summary, ingredients, method. On a wider
 * screen the ingredients sit beside the method. Amounts read as a recipe
 * writes them ("1½ tbsp", "1–2 tsp"), through `formatAmount()`.
 *
 * It refreshes like every page (on returning to the app, on reconnecting, and
 * with Refresh). If the recipe was deleted elsewhere, the page says so rather
 * than showing an error. Deleting from its ⋮ menu sends the ETag of the
 * version on screen.
 *
 * A recipe with a change waiting on the device (3c) shows that version, with
 * a notice saying when it was saved. That holds for a new recipe the server
 * hasn't seen yet, too. A change that couldn't upload says why, with the
 * choices that settle it (Step 18); one that met a change made elsewhere can
 * show either version.
 *
 * From 3b the ingredients are grouped by section, lines in no section first
 * with no heading, and the method is shown by section. A step with a timer
 * has a button that starts it with one tap. All of the recipe's tags show
 * under its name, each opening the list filtered by it, and its equipment
 * follows the ingredients. The main photo heads the page, labelled with how
 * many there are, and opens the recipe's Photos page; a recipe with none
 * offers to add one, unless it hasn't reached the server yet.
 *
 * The cooking mode switch keeps the screen on, and changes nothing else: the
 * whole recipe stays readable. It's off for each recipe you open, and leaving
 * the recipe turns it off. Printing shows only the name, ingredients and
 * method (the print rules in RecipePage.module.css).
 */

import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { formatAmount } from '../../../shared/quantity';
import { useRecipe } from '../api/queries';
import type { Recipe } from '../api/types';
import { recipeFromChange } from '../offline/upload';
import { useWaitingChanges } from '../offline/waiting';
import { SettleChange, WaitingNotice } from '../components/Waiting';
import { CookingMode } from '../cooking/CookingMode';
import { StepTimerButton } from '../timers/StepTimerButton';
import { pillColours, tagLabel } from '../tags/colour';
import { imageUrl } from '../images/media';
import { Photo } from '../images/Photo';
import { CameraIcon, PhotoIcon } from '../components/Icons';
import { BackLink } from '../components/BackLink';
import { DeleteRecipeDialog } from '../components/DeleteRecipeDialog';
import { ErrorBanner } from '../components/ErrorBanner';
import { Menu } from '../components/Menu';
import { recipeMenuItems } from '../components/recipeMenu';
import { useDocumentTitle } from '../components/useDocumentTitle';
import { ingredientGroups, recipeMeta } from '../format';
import page from '../components/Page.module.css';
import styles from './RecipePage.module.css';

export function RecipePage() {
    const { id = '' } = useParams();
    const location = useLocation();
    // The list passes its own address, search included, so "Recipes" goes back to it
    const backTo = (location.state as { from?: string } | null)?.from ?? '/';
    const navigate = useNavigate();
    const { data, error, isPending, refetch } = useRecipe(id);
    const change = useWaitingChanges().changes.find((candidate) => candidate.recipeId === id);
    // Their version or mine, while a change that met theirs is settled; mine otherwise, as the newest this device knows
    const [theirsFor, setTheirsFor] = useState<string | null>(null);
    const showingTheirs = theirsFor === id && change?.problem?.kind === 'changed' && data !== undefined;
    const recipe = change && !showingTheirs ? recipeFromChange(change, data?.data) : data?.data;
    const [deleting, setDeleting] = useState(false);
    // Cooking mode belongs to one recipe: opening another starts with it off
    const [cookingFor, setCookingFor] = useState<string | null>(null);
    const cooking = cookingFor === id;
    const deleted = !change && error?.status === 404;
    useDocumentTitle(deleted ? null : (recipe?.name ?? null));

    // Print from a ⋮ menu arrives as ?print: print once the recipe is on screen
    const [params, setParams] = useSearchParams();
    const printRequested = params.has('print');
    useEffect(() => {
        if (!printRequested || !recipe) return;
        setParams({}, { replace: true, state: location.state });
        window.print();
    }, [printRequested, recipe, setParams, location.state]);

    if (deleted) {
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
        <article className={styles.page}>
            <BackLink to={backTo}>Recipes</BackLink>
            {change &&
                (change.problem ? (
                    <SettleChange
                        change={change}
                        theirs={data}
                        showingTheirs={showingTheirs}
                        onShowTheirs={(theirs) => setTheirsFor(theirs ? id : null)}
                    />
                ) : (
                    <WaitingNotice change={change} />
                ))}
            {error && !change && <ErrorBanner error={error} onRetry={() => void refetch()} />}
            {isPending && !change && (
                <p role="status" className={page.status}>
                    Loading recipe…
                </p>
            )}
            {recipe && (
                <RecipeContent
                    recipe={recipe}
                    // A new recipe still on this device has no photos until it reaches the server
                    uploaded={!(change?.kind === 'create' && data === undefined)}
                    onDelete={() => setDeleting(true)}
                    cooking={cooking}
                    onCookingChange={(on) => setCookingFor(on ? id : null)}
                />
            )}
            <DeleteRecipeDialog
                recipe={deleting && recipe ? recipe : null}
                etag={change && !showingTheirs ? change.etag : data?.etag}
                onClose={() => setDeleting(false)}
                onDeleted={() => navigate('/', { replace: true })}
            />
        </article>
    );
}

interface RecipeContentProps {
    recipe: Recipe;
    uploaded: boolean;
    onDelete: () => void;
    cooking: boolean;
    onCookingChange: (on: boolean) => void;
}

function RecipeContent({ recipe, uploaded, onDelete, cooking, onCookingChange }: RecipeContentProps) {
    // A section with no steps only groups ingredient lines; the method leaves it out
    const method = recipe.sections.filter((section) => section.steps.length > 0);
    // One section called "Method" needs no heading of its own: it's what a migrated recipe has
    const named = method.length > 1 || (method.length === 1 && method[0]?.name !== 'Method');
    const groups = ingredientGroups(recipe);

    const photos = recipe.images.length;
    const mainPhoto = recipe.primaryImageId ?? recipe.images[0]?.id ?? null;

    return (
        <>
            {photos > 0 && (
                <Link
                    to={`/recipes/${recipe.id}/photos`}
                    className={styles.mainPhoto}
                    aria-label={`${recipe.name}'s photos: ${photos === 1 ? '1 photo' : `${photos} photos`}`}
                >
                    <Photo src={mainPhoto && imageUrl(mainPhoto)} alt="" className={styles.mainPhotoImage} plateSize={48} />
                    <span className={styles.photoCount}>
                        <PhotoIcon size={16} />
                        {photos === 1 ? '1 photo' : `${photos} photos`}
                    </span>
                </Link>
            )}
            <header className={styles.intro}>
                <div className={styles.titleRow}>
                    <h1 className={styles.title}>{recipe.name}</h1>
                    <Link to={`/recipes/${recipe.id}/edit`} className={styles.editButton}>
                        Edit
                    </Link>
                    <Menu
                        label={`More options for ${recipe.name}`}
                        items={recipeMenuItems(recipe.id, onDelete)}
                        buttonClassName={styles.menuButton}
                    />
                </div>
                {recipe.tags.length > 0 && (
                    <ul aria-label="Tags" className={styles.tags}>
                        {recipe.tags.map(({ tag }) => (
                            <li key={tag.id}>
                                {/* A tag made offline has no id yet, so nothing to filter by until it uploads */}
                                {tag.id.startsWith('new:') ? (
                                    <span className={styles.tag} style={pillColours(tag.color)}>
                                        {tagLabel(tag.name)}
                                    </span>
                                ) : (
                                    <Link to={`/?tag=${encodeURIComponent(tag.id)}`} className={styles.tag} style={pillColours(tag.color)}>
                                        {tagLabel(tag.name)}
                                    </Link>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
                {recipe.description && <p className={styles.description}>{recipe.description}</p>}
                <p className={styles.meta}>{recipeMeta(recipe)}</p>
                {photos === 0 &&
                    (uploaded ? (
                        <Link to={`/recipes/${recipe.id}/photos`} className={styles.addPhotos}>
                            <CameraIcon size={18} />
                            Add photos
                        </Link>
                    ) : (
                        <p className={styles.addPhotosLater}>Add photos once it's uploaded.</p>
                    ))}
                <div className={styles.cooking}>
                    <CookingMode on={cooking} onChange={onCookingChange} />
                </div>
            </header>

            <div className={styles.columns}>
                <div className={styles.ingredients}>
                    <section aria-labelledby="ingredients-heading">
                        <h2 id="ingredients-heading" className={styles.sectionTitle}>
                            Ingredients
                        </h2>
                        {groups.length === 0 ? (
                            <p className={styles.empty}>No ingredients yet.</p>
                        ) : (
                            groups.map((group) => (
                                <div key={group.section?.id ?? 'none'} className={styles.ingredientGroup}>
                                    {group.section && <h3 className={styles.groupName}>{group.section.name}</h3>}
                                    <ul className={styles.lines}>
                                        {group.lines.map((line) => (
                                            <li key={line.id} className={styles.line}>
                                                <span className={styles.amount}>
                                                    {formatAmount(line.quantity, line.quantityMax, line.unit)}
                                                </span>
                                                <span>
                                                    {line.ingredient.name}
                                                    {line.note && <span className={styles.note}>, {line.note}</span>}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            ))
                        )}
                    </section>

                    {recipe.equipment.length > 0 && (
                        <section aria-labelledby="equipment-heading" className={styles.equipment}>
                            <h2 id="equipment-heading" className={styles.sectionTitle}>
                                Equipment
                            </h2>
                            <ul className={styles.lines}>
                                {recipe.equipment.map((line) => (
                                    <li key={line.id} className={styles.line}>
                                        <span className={styles.amount}>{line.quantity}</span>
                                        <span className={styles.equipmentName}>{line.equipment.name}</span>
                                        {line.optional && <span className={styles.note}>optional</span>}
                                    </li>
                                ))}
                            </ul>
                        </section>
                    )}
                </div>

                <section aria-labelledby="method-heading" className={styles.method}>
                    <h2 id="method-heading" className={styles.sectionTitle}>
                        Method
                    </h2>
                    {method.length === 0 ? (
                        <p className={styles.empty}>No method yet.</p>
                    ) : (
                        method.map((section) => (
                            <div key={section.id} className={styles.methodSection}>
                                {named && <h3 className={styles.methodSectionName}>{section.name}</h3>}
                                <ol className={styles.steps}>
                                    {section.steps.map((step, index) => (
                                        <li key={step.id} className={styles.step}>
                                            <span className={styles.stepNumber}>{index + 1}</span>
                                            <div className={styles.stepBody}>
                                                <span>{step.text}</span>
                                                {step.timerSeconds !== null && (
                                                    <span className={styles.stepTimer}>
                                                        <StepTimerButton
                                                            stepId={step.id}
                                                            seconds={step.timerSeconds}
                                                            label={named ? `${section.name}, step ${index + 1}` : `Step ${index + 1}`}
                                                        />
                                                    </span>
                                                )}
                                            </div>
                                        </li>
                                    ))}
                                </ol>
                            </div>
                        ))
                    )}
                </section>
            </div>
        </>
    );
}
