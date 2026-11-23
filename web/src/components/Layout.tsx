/**
 * @module web/src/components/Layout
 * The frame around every page: the header, then the page itself.
 */

import { Link, Outlet } from 'react-router';
import styles from './Layout.module.css';

export function Layout() {
    return (
        <div className={styles.app}>
            <header className={styles.header}>
                <div className={styles.headerInner}>
                    <Link to="/" className={styles.title}>
                        Mise en place
                    </Link>
                    <Link to="/options" className={styles.iconLink} aria-label="Options">
                        <svg
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
                            <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" />
                            <circle cx="15" cy="6" r="2" />
                            <circle cx="9" cy="12" r="2" />
                            <circle cx="17" cy="18" r="2" />
                        </svg>
                    </Link>
                </div>
            </header>
            <main className={styles.main}>
                <Outlet />
            </main>
        </div>
    );
}
