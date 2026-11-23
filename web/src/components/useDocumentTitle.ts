/**
 * @module web/src/components/useDocumentTitle
 * Names the browser tab (and the app's window, once installed) after the page.
 */

import { useEffect } from 'react';

export function useDocumentTitle(title: string | null) {
    useEffect(() => {
        document.title = title ? `${title} · Mise en place` : 'Mise en place';
    }, [title]);
}
