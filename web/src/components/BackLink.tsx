/**
 * @module web/src/components/BackLink
 * The "‹ Recipes" link at the top of a page below the list. Screen readers
 * hear "Back to Recipes", so it isn't confused with the header's own links.
 */

import { Link } from 'react-router';
import { BackIcon } from './Icons';
import styles from './Page.module.css';

export function BackLink({ to, children }: { to: string; children: string }) {
    return (
        // The name still contains the visible word, so voice control can say "click Recipes"
        <Link to={to} className={styles.backLink} aria-label={`Back to ${children}`}>
            <BackIcon size={18} />
            {children}
        </Link>
    );
}
