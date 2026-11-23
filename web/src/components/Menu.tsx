/**
 * @module web/src/components/Menu
 * The ⋮ button and its menu, on each recipe row and on the recipe page.
 *
 * It follows the WAI-ARIA menu button pattern, so it works by touch, mouse and
 * keyboard: Enter, Space or the arrow keys open it with focus on an item; the
 * arrow keys, Home and End move between items; Escape closes it and returns
 * focus to the button; Tab or a tap outside closes it.
 */

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { MoreIcon } from './Icons';
import styles from './Menu.module.css';

export interface MenuItem {
    label: string;
    icon?: ReactNode;
    /** A page to go to. */
    to?: string;
    /** Something to do. Ignored when `to` is set. */
    onSelect?: () => void;
    danger?: boolean;
    /** Shown but can't be chosen, with `hint` saying why. */
    disabled?: boolean;
    hint?: string;
}

interface MenuProps {
    /** The button's name, such as "More options for Beef Chili". */
    label: string;
    items: MenuItem[];
    /** Extra classes for the button, so each place can size it. */
    buttonClassName?: string;
}

export function Menu({ label, items, buttonClassName }: MenuProps) {
    const [open, setOpen] = useState(false);
    // Which item to focus when the menu opens: the first, or the last after ArrowUp
    const [initialFocus, setInitialFocus] = useState<'first' | 'last'>('first');
    const menuId = useId();
    const containerRef = useRef<HTMLDivElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const itemRefs = useRef<(HTMLElement | null)[]>([]);

    const close = (returnFocus: boolean) => {
        setOpen(false);
        if (returnFocus) buttonRef.current?.focus();
    };

    useEffect(() => {
        if (!open) return;
        const items = itemRefs.current.filter((item) => item !== null);
        (initialFocus === 'first' ? items[0] : items[items.length - 1])?.focus();

        // A tap or click anywhere outside closes the menu
        const onPointerDown = (event: PointerEvent) => {
            if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
        };
        document.addEventListener('pointerdown', onPointerDown);
        return () => document.removeEventListener('pointerdown', onPointerDown);
    }, [open, initialFocus]);

    const openWith = (focus: 'first' | 'last') => {
        setInitialFocus(focus);
        setOpen(true);
    };

    const onButtonKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            openWith(event.key === 'ArrowDown' ? 'first' : 'last');
        }
    };

    const onMenuKeyDown = (event: KeyboardEvent) => {
        const items = itemRefs.current.filter((item) => item !== null);
        const index = items.indexOf(document.activeElement as HTMLElement);
        const focusAt = (next: number) => items[(next + items.length) % items.length]?.focus();

        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                focusAt(index + 1);
                break;
            case 'ArrowUp':
                event.preventDefault();
                focusAt(index - 1);
                break;
            case 'Home':
                event.preventDefault();
                focusAt(0);
                break;
            case 'End':
                event.preventDefault();
                focusAt(items.length - 1);
                break;
            case 'Escape':
                event.preventDefault();
                close(true);
                break;
            case 'Tab':
                close(false);
                break;
        }
    };

    return (
        <div className={styles.container} ref={containerRef}>
            <button
                ref={buttonRef}
                type="button"
                className={`${styles.button} ${buttonClassName ?? ''}`}
                aria-label={label}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls={open ? menuId : undefined}
                onClick={() => (open ? close(false) : openWith('first'))}
                onKeyDown={onButtonKeyDown}
            >
                <MoreIcon />
            </button>
            {open && (
                <div id={menuId} role="menu" aria-label={label} className={styles.menu} onKeyDown={onMenuKeyDown}>
                    {items.map((item, index) => {
                        const className = `${styles.item} ${item.danger ? styles.danger : ''}`;
                        const content = (
                            <>
                                {item.icon}
                                <span className={styles.itemText}>
                                    {item.label}
                                    {item.hint && <span className={styles.hint}>{item.hint}</span>}
                                </span>
                            </>
                        );
                        const ref = (element: HTMLElement | null) => {
                            itemRefs.current[index] = element;
                        };

                        if (item.to && !item.disabled) {
                            return (
                                <Link key={item.label} ref={ref} role="menuitem" tabIndex={-1} to={item.to} className={className}>
                                    {content}
                                </Link>
                            );
                        }
                        return (
                            <button
                                key={item.label}
                                ref={ref}
                                type="button"
                                role="menuitem"
                                tabIndex={-1}
                                className={className}
                                // aria-disabled rather than disabled, so the item can still be focused and read
                                aria-disabled={item.disabled || undefined}
                                onClick={() => {
                                    if (item.disabled) return;
                                    close(true);
                                    item.onSelect?.();
                                }}
                            >
                                {content}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
