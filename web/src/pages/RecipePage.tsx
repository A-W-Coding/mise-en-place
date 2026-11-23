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
import { CookingMode } from '../cooking/CookingMode';
import { BackLink } from '../components/BackLink';
import { DeleteRecipeDialog } from '../components/DeleteRecipeDialog';
import { ErrorBanner } from '../components/ErrorBanner';
import { Menu } from '../components/Menu';
import { recipeMenuItems } from '../components/recipeMenu';
import { useDocumentTitle } from '../components/useDocumentTitle';
import { methodSteps, recipeMeta } from '../format';
import page from '../components/Page.module.css';
import styles from './RecipePage.module.css';

export function RecipePage() {
    const { id = '' } = useParams();
    const location = useLocation();
    // The list passes its own address, search included, so "Recipes" goes back to it
    const backTo = (location.state as { from?: string } | null)?.from ?? '/';
    const navigate = useNavigate();
    const { data, error, isPending, refetch } = useRecipe(id);
    const recipe = data?.data;
    const [deleting, setDeleting] = useState(false);
    // Cooking mode belongs to one recipe: opening another starts with it off
    const [cookingFor, setCookingFor] = useState<string | null>(null);
    const cooking = cookingFor === id;
    const deleted = error?.status === 404;
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
            {error && <ErrorBanner error={error} onRetry={() => void refetch()} />}
            {isPending && (
                <p role="status" className={page.status}>
                    Loading recipe…
                </p>
            )}
            {recipe && (
                <RecipeContent
                    recipe={recipe}
                    onDelete={() => setDeleting(true)}
                    cooking={cooking}
                    onCookingChange={(on) => setCookingFor(on ? id : null)}
                />
            )}
            <DeleteRecipeDialog
                recipe={deleting && recipe ? recipe : null}
                etag={data?.etag}
                onClose={() => setDeleting(false)}
                onDeleted={() => navigate('/', { replace: true })}
            />
        </article>
    );
}

interface RecipeContentProps {
    recipe: Recipe;
    onDelete: () => void;
    cooking: boolean;
    onCookingChange: (on: boolean) => void;
}

function RecipeContent({ recipe, onDelete, cooking, onCookingChange }: RecipeContentProps) {
    const steps = methodSteps(recipe.instructions);

    return (
        <>
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
                {/* 3b adds all of the recipe's tags here */}
                {recipe.description && <p className={styles.description}>{recipe.description}</p>}
                <p className={styles.meta}>{recipeMeta(recipe)}</p>
                <div className={styles.cooking}>
                    <CookingMode on={cooking} onChange={onCookingChange} />
                </div>
            </header>

            <div className={styles.columns}>
                <section aria-labelledby="ingredients-heading" className={styles.ingredients}>
                    <h2 id="ingredients-heading" className={styles.sectionTitle}>
                        Ingredients
                    </h2>
                    {recipe.recipeIngredients.length === 0 ? (
                        <p className={styles.empty}>No ingredients yet.</p>
                    ) : (
                        <ul className={styles.lines}>
                            {recipe.recipeIngredients.map((line) => (
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
                    )}
                </section>

                <section aria-labelledby="method-heading" className={styles.method}>
                    <h2 id="method-heading" className={styles.sectionTitle}>
                        Method
                    </h2>
                    {steps.length === 0 ? (
                        <p className={styles.empty}>No method yet.</p>
                    ) : (
                        <ol className={styles.steps}>
                            {steps.map((step, index) => (
                                <li key={index} className={styles.step}>
                                    <span className={styles.stepNumber}>{index + 1}</span>
                                    <span>{step}</span>
                                </li>
                            ))}
                        </ol>
                    )}
                </section>
            </div>
        </>
    );
}
