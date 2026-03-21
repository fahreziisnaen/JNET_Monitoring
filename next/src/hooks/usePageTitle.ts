'use client';

import { useEffect } from 'react';

/**
 * Sets the browser tab title dynamically for client components.
 * Format: "{title} | JNET"
 */
export function usePageTitle(title: string) {
    useEffect(() => {
        if (!title) return;
        document.title = `${title} | JNET Monitoring`;
        return () => {
            document.title = 'JNET Monitoring';
        };
    }, [title]);
}
