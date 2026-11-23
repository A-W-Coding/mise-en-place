/**
 * @module web/src/components/SearchBox
 * The search box on the recipe and ingredient lists. `useSearchQuery` holds
 * its value.
 */

import { SearchIcon } from './Icons';
import styles from './Page.module.css';

interface SearchBoxProps {
    /** The box's name and placeholder, such as "Search recipes". */
    label: string;
    value: string;
    onChange: (value: string) => void;
    className?: string;
}

export function SearchBox({ label, value, onChange, className }: SearchBoxProps) {
    return (
        <label className={`${styles.search} ${className ?? ''}`}>
            <SearchIcon size={18} />
            <span className="visually-hidden">{label}</span>
            <input
                type="search"
                className={styles.searchInput}
                placeholder={label}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                autoComplete="off"
                enterKeyHint="search"
            />
        </label>
    );
}
