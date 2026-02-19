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

        const connectWs = () => {
            const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:5000';
            const ws = new WebSocket(`${wsUrl}?token=${token}`);
            wsRef.current = ws;

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);

                    if (data.type === 'connection-status') {
                        const { status, message, deviceId } = data.payload;

                        if (status === 'disconnected') {
                            // Show persistent destructive toast
                            toastIdRef.current = toast.error('Koneksi Terputus', {
                                description: message || 'Koneksi ke perangkat Mikrotik terputus.',
                                duration: Infinity, // Persistent until reconnected
                                action: {
                                    label: 'Reconnect',
                                    onClick: () => window.location.reload()
                                }
                            });
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
                    }
                } catch (e) {
                    // Ignore parsing errors
                }
            };

            ws.onclose = () => {
                // Reconnect logic managed by polling in other components, 
                // but here we just want to listen to events when connected.
                setTimeout(connectWs, 5000);
            };
        };

        connectWs();

        return () => {
            if (wsRef.current) {
                wsRef.current.close();
            }
        };
    }, [token, user]);

    return null; // This component doesn't render anything visible directly
}
