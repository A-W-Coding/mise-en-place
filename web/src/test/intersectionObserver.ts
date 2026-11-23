/**
 * @module web/src/test/intersectionObserver
 * A stand-in IntersectionObserver for jsdom, which has none and does no
 * layout. Tests call `scrollNearEnd()` to say "the observed elements are now
 * near the screen", which is what the infinite lists wait for.
 */

import { act } from '@testing-library/react';

export class MockIntersectionObserver {
    static instances: MockIntersectionObserver[] = [];

    private readonly callback: IntersectionObserverCallback;
    private readonly elements = new Set<Element>();

    constructor(callback: IntersectionObserverCallback) {
        this.callback = callback;
        MockIntersectionObserver.instances.push(this);
    }

    observe(element: Element) {
        this.elements.add(element);
    }

    unobserve(element: Element) {
        this.elements.delete(element);
    }

    disconnect() {
        this.elements.clear();
    }

    takeRecords(): IntersectionObserverEntry[] {
        return [];
    }

    /** Report every observed element as intersecting. */
    intersect() {
        if (this.elements.size === 0) return;
        const entries = [...this.elements].map((target) => ({ target, isIntersecting: true }) as IntersectionObserverEntry);
        this.callback(entries, this as unknown as IntersectionObserver);
    }

    static reset() {
        MockIntersectionObserver.instances = [];
    }
}

/** Scroll the end of the list into range: every live observer reports its elements. */
export function scrollNearEnd() {
    act(() => {
        MockIntersectionObserver.instances.forEach((observer) => observer.intersect());
    });
}
