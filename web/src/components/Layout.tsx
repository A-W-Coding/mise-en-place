/**
 * @module web/src/components/Layout
 * The frame around every page: the header, then the page itself.
 *
 * The header's Refresh button refetches everything on screen at once
 * ("Keeping devices in step", technical spec §3.4). Its icon spins while any
 * request is in flight, including the automatic refreshes.
 *
 * Running timers show along the bottom of every page, and the page makes room
 * for them so they never cover the recipe.
 */

import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, ScrollRestoration } from 'react-router';
import { TimerBar } from '../timers/TimerBar';
import { TimerDialog } from '../timers/TimerDialog';
import { useTimerState } from '../timers/timerStore';
import { OptionsIcon, RefreshIcon } from './Icons';
import styles from './Layout.module.css';

export function Layout() {
    const queryClient = useQueryClient();
    const fetching = useIsFetching() > 0;
    const { timers } = useTimerState();

    return (
        <div className={`${styles.app} ${timers.length > 0 ? styles.withTimers : ''}`}>
            <header className={styles.header}>
                <div className={styles.headerInner}>
                    <Link to="/" className={styles.title}>
                        Mise en place
                    </Link>
                    <button
                        type="button"
                        className={styles.headerButton}
                        onClick={() => void queryClient.refetchQueries({ type: 'active' })}
                    >
                        <RefreshIcon className={fetching ? styles.spinning : undefined} />
                        <span className={styles.label}>Refresh</span>
                    </button>
                    <Link to="/options" className={styles.headerButton}>
                        <OptionsIcon />
                        <span className={styles.label}>Options</span>
                    </Link>
                </div>
            </header>
            <main className={styles.main}>
                <Outlet />
            </main>
            <TimerBar />
            <TimerDialog />
            {/* Back to the list returns to where you were in it */}
            <ScrollRestoration />
        </div>
    );
}
