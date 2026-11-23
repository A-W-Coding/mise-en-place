/**
 * @module web/src/components/Icons
 * The app's few line icons, drawn on a 24-unit grid in the text's colour.
 * They're decorative: the button or link around each one carries its name.
 */

import type { ReactNode, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 20, children, ...props }: IconProps & { children: ReactNode }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
            {...props}
        >
            {children}
        </svg>
    );
}

export function RefreshIcon(props: IconProps) {
    return (
        <Icon {...props}>
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
            <path d="M21 3v6h-6" />
        </Icon>
    );
}

export function OptionsIcon(props: IconProps) {
    return (
        <Icon {...props}>
            <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" />
            <circle cx="15" cy="6" r="2" />
            <circle cx="9" cy="12" r="2" />
            <circle cx="17" cy="18" r="2" />
        </Icon>
    );
}

export function SearchIcon(props: IconProps) {
    return (
        <Icon {...props}>
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
        </Icon>
    );
}

export function PlusIcon(props: IconProps) {
    return (
        <Icon strokeWidth="2.2" {...props}>
            <path d="M12 5v14M5 12h14" />
        </Icon>
    );
}

export function BackIcon(props: IconProps) {
    return (
        <Icon {...props}>
            <path d="M15 18l-6-6 6-6" />
        </Icon>
    );
}

export function ChevronRightIcon(props: IconProps) {
    return (
        <Icon {...props}>
            <path d="M9 18l6-6-6-6" />
        </Icon>
    );
}

export function MoreIcon(props: IconProps) {
    return (
        <Icon fill="currentColor" stroke="none" {...props}>
            <circle cx="12" cy="5" r="1.8" />
            <circle cx="12" cy="12" r="1.8" />
            <circle cx="12" cy="19" r="1.8" />
        </Icon>
    );
}

export function EditIcon(props: IconProps) {
    return (
        <Icon {...props}>
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
        </Icon>
    );
}

export function PrintIcon(props: IconProps) {
    return (
        <Icon {...props}>
            <path d="M6 9V3h12v6" />
            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
            <path d="M6 14h12v7H6z" />
        </Icon>
    );
}

export function DeleteIcon(props: IconProps) {
    return (
        <Icon {...props}>
            <path d="M3 6h18" />
            <path d="M8 6V4h8v2" />
            <path d="M19 6l-1 14H6L5 6" />
            <path d="M10 11v6M14 11v6" />
        </Icon>
    );
}
