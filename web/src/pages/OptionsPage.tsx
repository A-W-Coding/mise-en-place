import { Link } from 'react-router';
import { Placeholder } from '../components/Placeholder';

/** `/options`: theme, text size, timer sound, connection, and Advanced › Ingredients (Step 11). */
export function OptionsPage() {
    return (
        <Placeholder title="Options" step={11}>
            <p>
                Advanced: <Link to="/options/ingredients">Ingredients</Link>
            </p>
        </Placeholder>
    );
}
