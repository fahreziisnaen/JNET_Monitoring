'use client';

import { useEffect, useRef } from 'react';
import { useAuth } from '@/components/providers/auth-provider';
import { toast } from 'sonner';

export default function ConnectionStatusToast() {
    const { token, user } = useAuth();
    const wsRef = useRef<WebSocket | null>(null);
    const toastIdRef = useRef<string | string | number | null>(null);

    useEffect(() => {
        if (!token || !user) return;

        const handleStatusEvent = (event: any) => {
            const data = event.detail;
            if (!data) return;

            const { status, message } = data;

            if (status === 'disconnected') {
                // Show persistent destructive toast
                if (!toastIdRef.current) {
                    toastIdRef.current = toast.error('Koneksi Terputus', {
                        description: message || 'Koneksi ke perangkat Mikrotik terputus.',
                        duration: Infinity, // Persistent until reconnected
                        action: {
                            label: 'Reconnect',
                            onClick: () => window.location.reload()
                        }
                    });
                }
            } else if (status === 'connected') {
                // Dismiss disconnected toast if exists
                if (toastIdRef.current) {
                    toast.dismiss(toastIdRef.current);
                    toastIdRef.current = null;
                }

                // Show success toast briefly
                toast.success('Terhubung Kembali', {
                    description: 'Koneksi ke perangkat Mikrotik berhasil dipulihkan.',
                    duration: 3000
                });
            }
        };

        window.addEventListener('mikrotik-connection-status', handleStatusEvent);

        return () => {
            window.removeEventListener('mikrotik-connection-status', handleStatusEvent);
        };
    }, [token, user]);

    return null; // This component doesn't render anything visible directly
}
