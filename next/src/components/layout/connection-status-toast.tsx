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

            const { status, message, deviceName } = data;

            // Ignore intentional disconnections ('Device changed' or 'Unselected')
            if (status === 'disconnected' && (message === 'Device changed' || message === 'Unselected')) {
                return;
            }

            if (status === 'disconnected') {
                wasConnectedRef.current = false;
                // Show persistent destructive toast
                if (!toastIdRef.current) {
                    toastIdRef.current = toast.error(deviceName ? `Offline: ${deviceName}` : 'Koneksi Terputus', {
                        description: message || `Koneksi ke perangkat ${deviceName || 'Mikrotik'} terputus.`,
                        duration: Infinity // Persistent until reconnected
                    });
                }
            } else if (status === 'connected') {
                // If it was previously disconnected and we had a toast, dismiss it and show Reconnected
                if (toastIdRef.current) {
                    toast.dismiss(toastIdRef.current);
                    toastIdRef.current = null;

                    toast.success(deviceName ? `Online: ${deviceName}` : 'Terhubung Kembali', {
                        description: message || `Koneksi ke perangkat ${deviceName || 'Mikrotik'} berhasil dipulihkan.`,
                        duration: 3000
                    });
                }
                // Mark as successfully connected
                wasConnectedRef.current = true;
            }
        };

        // Handler for PPPoE client going OFFLINE
        const handleDowntimeNotification = (event: any) => {
            const data = event.detail;
            if (!data?.users?.length) return;

            const { users, deviceName } = data;
            const deviceContext = deviceName ? ` (${deviceName})` : '';

            if (users.length === 1) {
                toast.error(`Client Offline${deviceContext}`, {
                    description: `User ${users[0]} terputus dari jaringan.`,
                    duration: 8000,
                });
            } else {
                toast.error(`${users.length} Client Offline${deviceContext}`, {
                    description: users.slice(0, 3).join(', ') + (users.length > 3 ? ` +${users.length - 3} lainnya` : '') + ' terputus.',
                    duration: 8000,
                });
            }
        };

        // Handler for PPPoE client coming back ONLINE
        const handleReconnectNotification = (event: any) => {
            const data = event.detail;
            if (!data?.users?.length) return;

            const { users, deviceName } = data;
            const deviceContext = deviceName ? ` (${deviceName})` : '';

            if (users.length === 1) {
                toast.success(`Client Online${deviceContext}`, {
                    description: `User ${users[0]} kembali terhubung.`,
                    duration: 6000,
                });
            } else {
                toast.success(`${users.length} Client Online${deviceContext}`, {
                    description: users.slice(0, 3).join(', ') + (users.length > 3 ? ` +${users.length - 3} lainnya` : '') + ' kembali terhubung.',
                    duration: 6000,
                });
            }
        };

        window.addEventListener('mikrotik-connection-status', handleStatusEvent);
        window.addEventListener('downtime-notification', handleDowntimeNotification);
        window.addEventListener('reconnect-notification', handleReconnectNotification);

        return () => {
            window.removeEventListener('mikrotik-connection-status', handleStatusEvent);
            window.removeEventListener('downtime-notification', handleDowntimeNotification);
            window.removeEventListener('reconnect-notification', handleReconnectNotification);
        };
    }, [token, user]);

    return null; // This component doesn't render anything visible directly
}
