'use client';

import React, { useState, useEffect } from 'react';
import { ServerCrash, Loader2 } from 'lucide-react';
import { apiFetch } from '@/utils/api';

export function BackendOfflineOverlay() {
    const [isOffline, setIsOffline] = useState(false);
    const [isTesting, setIsTesting] = useState(false);

    useEffect(() => {
        const handleOfflineEvent = () => {
            // Hanya aktifkan overlay jika sebelumnya belum aktif untuk mencegah re-render berlebih
            if (!isOffline) {
                setIsOffline(true);
            }
        };

        window.addEventListener('backend-connection-error', handleOfflineEvent);

        // Active Heartbeat Ping: Mengecek backend secara mandiri setiap 5 detik
        let heartbeatInterval: NodeJS.Timeout;
        if (!isOffline) {
            heartbeatInterval = setInterval(async () => {
                try {
                    const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL || '';
                    await fetch(`${apiUrl}/api/health`, { method: 'HEAD', cache: 'no-store' });
                } catch (error) {
                    // Jika ping mandiri gagal (NetworkError), langsung picu overlay!
                    handleOfflineEvent();
                }
            }, 5000);
        }

        return () => {
            window.removeEventListener('backend-connection-error', handleOfflineEvent);
            if (heartbeatInterval) clearInterval(heartbeatInterval);
        };
    }, [isOffline]);

    // Polling to check if backend is back online
    useEffect(() => {
        let interval: NodeJS.Timeout;

        if (isOffline) {
            interval = setInterval(async () => {
                setIsTesting(true);
                try {
                    const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL || '';
                    // Coba ping ringan ke server. Jika statusnya berhasil merespon tanpa throw error network, tutup overlay.
                    // Kita pakai endpoint ringan (workspaces/me), asalkan server merespon (bahkan 401 Unauthorized), 
                    // berarti server Node.js sudah bangun dan bisa meroute request lagi.
                    await fetch(`${apiUrl}/api/health`, { method: 'HEAD', cache: 'no-store' });
                    // Backend is back! Force a full page reload so all data fetches seamlessly without user intervention.
                    window.location.reload();
                } catch (error) {
                    // Masih offline, tunggu siklus berikutnya
                } finally {
                    setIsTesting(false);
                }
            }, 3000);
        }

        return () => {
            if (interval) clearInterval(interval);
        };
    }, [isOffline]);

    if (!isOffline) return null;

    return (
        <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-background/95 backdrop-blur-md">
            <div className="flex flex-col items-center max-w-md p-8 text-center space-y-6 animate-in zoom-in duration-300">
                <ServerCrash className="w-24 h-24 text-destructive animate-pulse" />
                <div className="space-y-2">
                    <h2 className="text-3xl font-bold tracking-tight text-foreground">Koneksi Backend Terputus</h2>
                    <p className="text-muted-foreground">
                        Aplikasi tidak dapat menjangkau server utama. Pastikan server Node.js sedang berjalan dan koneksi jaringan Anda stabil.
                    </p>
                </div>
                <div className="flex items-center gap-3 px-4 py-2 bg-secondary rounded-full">
                    {isTesting ? (
                        <Loader2 className="w-5 h-5 text-primary animate-spin" />
                    ) : (
                        <div className="w-5 h-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                    )}
                    <span className="text-sm font-medium tracking-wide">Mencoba menghubungkan kembali...</span>
                </div>
            </div>
        </div>
    );
}
