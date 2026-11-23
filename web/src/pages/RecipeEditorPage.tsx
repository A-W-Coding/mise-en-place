import { useParams } from 'react-router';
import { Placeholder } from '../components/Placeholder';

/** `/recipes/new` and `/recipes/:id/edit`: the recipe editor (Step 12). */
export function RecipeEditorPage() {
    const { id } = useParams();
    return <Placeholder title={id ? 'Edit recipe' : 'New recipe'} step={12} />;
}
