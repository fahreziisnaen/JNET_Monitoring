'use client';

import { useEffect, useRef } from 'react';
import { useAuth } from '@/components/providers/auth-provider';
import { toast } from 'sonner';

export default function ConnectionStatusToast() {
    const { token, user } = useAuth();
    const wsRef = useRef<WebSocket | null>(null);
    const toastIdRef = useRef<string | number | null>(null);
    const wasConnectedRef = useRef<boolean>(false);

    useEffect(() => {
        if (!token || !user) return;

        const handleStatusEvent = (event: any) => {
            const data = event.detail;
            if (!data) return;

            const { status, message, code } = data;

            // Ignore 'Device changed' disconnections (1000 closure with this reason)
            if (status === 'disconnected' && message === 'Device changed') {
                return;
            }

            if (status === 'disconnected') {
                wasConnectedRef.current = false;
                // Show persistent destructive toast
                if (!toastIdRef.current) {
                    toastIdRef.current = toast.error('Koneksi Terputus', {
                        description: message || 'Koneksi ke perangkat Mikrotik terputus.',
                        duration: Infinity // Persistent until reconnected
                    });
                }
            } else if (status === 'connected') {
                // If it was previously disconnected and we had a toast, dismiss it and show Reconnected
                if (toastIdRef.current) {
                    toast.dismiss(toastIdRef.current);
                    toastIdRef.current = null;

                    toast.success('Terhubung Kembali', {
                        description: 'Koneksi ke perangkat Mikrotik berhasil dipulihkan.',
                        duration: 3000
                    });
                } else if (!wasConnectedRef.current) {
                    // Optional: You could show an initial 'Terhubung' toast here, but user finds it annoying.
                    // Doing nothing on initial load.
                }

                // Mark as successfully connected
                wasConnectedRef.current = true;
            }
        };

        window.addEventListener('mikrotik-connection-status', handleStatusEvent);

        return () => {
            window.removeEventListener('mikrotik-connection-status', handleStatusEvent);
        };
    }, [token, user]);

    return null; // This component doesn't render anything visible directly
}
