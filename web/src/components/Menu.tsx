/**
 * @module web/src/components/Menu
 * The ⋮ button and its menu, on each recipe row and on the recipe page.
 *
 * It follows the WAI-ARIA menu button pattern, so it works by touch, mouse and
 * keyboard: Enter, Space or the arrow keys open it with focus on an item; the
 * arrow keys, Home and End move between items; Escape closes it and returns
 * focus to the button; Tab or a tap outside closes it.
 *
 * Items can also be a choice of one (3b): items that share a `group` are
 * shown together under its name, each a `menuitemradio`, ticked when
 * `checked`. A line's Section is one.
 */

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { CheckIcon, MoreIcon } from './Icons';
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
    /** Makes the item one of a choice: shown under this heading with the items that share it. */
    group?: string;
    /** Whether this choice is the one made. Only for items in a `group`. */
    checked?: boolean;
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
                    {groupItems(items).map((part) =>
                        part.group === undefined ? (
                            renderItem(part.items[0] as MenuItem, part.start)
                        ) : (
                            <div key={`group-${part.start}`} role="group" aria-label={part.group} className={styles.group}>
                                <span aria-hidden="true" className={styles.groupLabel}>
                                    {part.group}
                                </span>
                                {part.items.map((item, offset) => renderItem(item, part.start + offset))}
                            </div>
                        ),
                    )}
                </div>
            )}
        </div>
    );

    function renderItem(item: MenuItem, index: number) {
        const choice = item.group !== undefined;
        const className = `${styles.item} ${item.danger ? styles.danger : ''} ${item.checked ? styles.checked : ''}`;
        const content = (
            <>
                {choice ? <span className={styles.tick}>{item.checked && <CheckIcon size={16} />}</span> : item.icon}
                <span className={styles.itemText}>
                    {item.label}
                    {item.hint && <span className={styles.hint}>{item.hint}</span>}
                </span>
            </>
        );
        const ref = (element: HTMLElement | null) => {
            itemRefs.current[index] = element;
        };
        const key = `${index}:${item.label}`;

        if (item.to && !item.disabled) {
            return (
                <Link key={key} ref={ref} role="menuitem" tabIndex={-1} to={item.to} className={className}>
                    {content}
                </Link>
            );
        }
        return (
            <button
                key={key}
                ref={ref}
                type="button"
                role={choice ? 'menuitemradio' : 'menuitem'}
                aria-checked={choice ? Boolean(item.checked) : undefined}
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
    }
}

/** The items in runs: each ungrouped item alone, and each run of items sharing a group together. */
function groupItems(items: MenuItem[]): { group?: string; start: number; items: MenuItem[] }[] {
    const parts: { group?: string; start: number; items: MenuItem[] }[] = [];
    items.forEach((item, index) => {
        const last = parts[parts.length - 1];
        if (item.group !== undefined && last?.group === item.group) last.items.push(item);
        else parts.push({ group: item.group, start: index, items: [item] });
    });
    return parts;
}
