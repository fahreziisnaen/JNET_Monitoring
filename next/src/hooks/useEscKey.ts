import { useEffect } from 'react';

/**
 * Hook untuk menutup modal/panel saat tombol Escape ditekan.
 * Listener hanya dipasang ketika `isOpen === true` dan di-cleanup otomatis.
 *
 * @param isOpen  - Apakah modal sedang terbuka
 * @param onClose - Fungsi yang dipanggil saat Esc ditekan
 */
export function useEscKey(isOpen: boolean, onClose: () => void) {
    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                onClose();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);
}
