'use client';

import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { useAuth } from './auth-provider';
import { apiFetch, getAuthToken } from '@/utils/api';

const MikrotikContext = createContext<any>(null);

export const useMikrotik = () => {
    return useContext(MikrotikContext);
};

export const MikrotikProvider = ({ children }: { children: React.ReactNode }) => {
    const { user } = useAuth();
    const [selectedDeviceId, setSelectedDeviceId] = useState<number | null>(null);
    const [resource, setResource] = useState(null);
    const [pppoeActive, setPppoeActive] = useState([]);
    const [activeInterfaces, setActiveInterfaces] = useState<Array<{name: string, type: string, running: boolean}>>([]);
    const [traffic, setTraffic] = useState({});
    const [isConnected, setIsConnected] = useState(false);
    
    const ws = useRef<WebSocket | null>(null);
    
    // Load selected device from localStorage
    useEffect(() => {
        if (user?.workspace_id) {
            const saved = localStorage.getItem(`selected-device-${user.workspace_id}`);
            if (saved) {
                try {
                    const deviceId = parseInt(saved);
                    if (!isNaN(deviceId)) {
                        setSelectedDeviceId(deviceId);
                    }
                } catch (e) {
                    console.error('Failed to parse saved device ID:', e);
                }
            }
        }
    }, [user]);

    useEffect(() => {
        if (!user) {
            if (ws.current) {
                ws.current.close();
                ws.current = null;
            }
            setIsConnected(false);
            setResource(null);
            setPppoeActive([]);
            setActiveInterfaces([]);
            setTraffic({});
            return;
        }

        // Fetch snapshot terlebih dahulu untuk instant load
        const fetchSnapshot = async () => {
            if (!selectedDeviceId) return; // Wait for device selection
            
            try {
                const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
                const res = await apiFetch(`${apiUrl}/api/dashboard/snapshot?deviceId=${selectedDeviceId}`);
                
                if (res.ok) {
                    const data = await res.json();
                    // Set data dari snapshot jika ada
                    if (data.resource) {
                        setResource(data.resource);
                    }
                    if (data.pppoeActive && Array.isArray(data.pppoeActive)) {
                        setPppoeActive(data.pppoeActive);
                    }
                    if (data.activeInterfaces && Array.isArray(data.activeInterfaces)) {
                        setActiveInterfaces(data.activeInterfaces);
                    }
                    if (data.traffic && typeof data.traffic === 'object') {
                        setTraffic(data.traffic);
                    }
                } else {
                    console.warn('[Snapshot] Response tidak OK:', res.status);
                }
            } catch (error) {
                console.error('[Snapshot] Error fetching snapshot:', error);
                // Continue dengan WebSocket connection meskipun snapshot gagal
            }
        };

        fetchSnapshot();

        let reconnectTimeout: NodeJS.Timeout | null = null;
        let reconnectAttempts = 0;
        const maxReconnectAttempts = 5;
        const reconnectDelay = 3000; // 3 detik

        const connectWebSocket = () => {
            if (!selectedDeviceId) return; // Wait for device selection
            
            if (ws.current?.readyState === WebSocket.OPEN) {
                // Check if device changed
                const currentUrl = ws.current.url;
                const expectedDeviceId = new URL(currentUrl).searchParams.get('deviceId');
                if (expectedDeviceId === selectedDeviceId.toString()) {
                    return; // Same device, already connected
                } else {
                    // Device changed, close and reconnect
                    ws.current.close();
                    ws.current = null;
                }
            }

            const wsUrl = process.env.NEXT_PUBLIC_WS_BASE_URL;
            if (!wsUrl) {
                console.error('[WebSocket] NEXT_PUBLIC_WS_BASE_URL tidak dikonfigurasi!');
                return;
            }

            try {
                // WebSocket tidak bisa mengirim Authorization header atau cookie dengan mudah
                // Jadi kita kirim token via query parameter
                // Gunakan helper function yang sudah ada untuk mendapatkan token dari localStorage atau cookie
                const token = getAuthToken();
                if (!token) {
                    console.error('[WebSocket] Tidak ada token ditemukan di localStorage maupun cookie, tidak bisa connect');
                    setIsConnected(false);
                    return;
                }
                
                const wsUrlWithParams = `${wsUrl}?deviceId=${selectedDeviceId}&token=${encodeURIComponent(token)}`;
                console.log('[WebSocket] Connecting dengan token dari localStorage/cookie');
                
                const socket = new WebSocket(wsUrlWithParams);
                ws.current = socket;

                socket.onopen = () => {
                    console.log("[WebSocket] Koneksi berhasil dibuat.");
                    setIsConnected(true);
                    reconnectAttempts = 0; // Reset counter setelah berhasil connect
                };

                socket.onclose = () => {
                    setIsConnected(false);
                    ws.current = null;
                    console.log('[WebSocket] Koneksi ditutup.');
                    
                    // Auto-reconnect jika masih ada user dan belum mencapai max attempts
                    if (user && reconnectAttempts < maxReconnectAttempts) {
                        reconnectAttempts++;
                        console.log(`[WebSocket] Mencoba reconnect (${reconnectAttempts}/${maxReconnectAttempts}) dalam ${reconnectDelay/1000} detik...`);
                        reconnectTimeout = setTimeout(() => {
                            connectWebSocket();
                        }, reconnectDelay);
                    } else if (reconnectAttempts >= maxReconnectAttempts) {
                        console.error('[WebSocket] Gagal reconnect setelah beberapa kali percobaan.');
                    }
                };

                socket.onerror = (error) => {
                    // Jangan log error jika socket sudah ditutup atau dalam proses closing
                    if (socket.readyState === WebSocket.CLOSING || socket.readyState === WebSocket.CLOSED) {
                        return;
                    }
                    console.warn('[WebSocket Error]:', error);
                    setIsConnected(false);
                };

                socket.onmessage = (event) => {
                    try {
                        const message = JSON.parse(event.data);
                        console.log("[WebSocket] Pesan diterima:", message.type, message.payload ? 'dengan payload' : 'tanpa payload');
                        if (message.type === 'batch-update' && message.payload) {
                            console.log("[WebSocket] Memproses batch-update:", {
                                hasResource: !!message.payload.resource && Object.keys(message.payload.resource).length > 0,
                                pppoeCount: message.payload.pppoeActive?.length || 0,
                                activeInterfacesCount: message.payload.activeInterfaces?.length || 0,
                                trafficCount: Object.keys(message.payload.traffic || {}).length
                            });
                            setResource(message.payload.resource);
                            setPppoeActive(message.payload.pppoeActive);
                            setActiveInterfaces(message.payload.activeInterfaces || []);
                            setTraffic(message.payload.traffic);
                        } else if (message.type === 'downtime-notification' && message.payload) {
                            // Forward downtime notification ke notification provider via custom event
                            console.log("[WebSocket] Menerima downtime notification:", message.payload);
                            window.dispatchEvent(new CustomEvent('downtime-notification', {
                                detail: message.payload
                            }));
                        } else if (message.type === 'reconnect-notification' && message.payload) {
                            // Forward reconnect notification ke notification provider via custom event
                            console.log("[WebSocket] Menerima reconnect notification:", message.payload);
                            window.dispatchEvent(new CustomEvent('reconnect-notification', {
                                detail: message.payload
                            }));
                        } else {
                            console.warn("[WebSocket] Pesan tidak dikenali atau tidak memiliki payload:", message);
                        }
                    } catch (e) {
                        console.error("[WebSocket] Gagal parsing pesan:", e, "Raw data:", event.data);
                    }
                };
            } catch (error) {
                console.error('[WebSocket] Error saat membuat koneksi:', error);
                setIsConnected(false);
            }
        };

        // Connect jika belum ada koneksi
        if (selectedDeviceId && (!ws.current || ws.current.readyState === WebSocket.CLOSED)) {
            connectWebSocket();
        }

        return () => {
            if (reconnectTimeout) {
                clearTimeout(reconnectTimeout);
            }
            if (ws.current && (!user || !selectedDeviceId)) {
                ws.current.close();
                ws.current = null;
            }
        };
    }, [user, selectedDeviceId]);

    const handleDeviceChange = (deviceId: number | null) => {
        setSelectedDeviceId(deviceId);
        if (user?.workspace_id && deviceId) {
            localStorage.setItem(`selected-device-${user.workspace_id}`, deviceId.toString());
        }
        // Close WebSocket to reconnect with new device
        if (ws.current) {
            ws.current.close();
            ws.current = null;
        }
        // Clear data
        setResource(null);
        setPppoeActive([]);
        setActiveInterfaces([]);
        setTraffic({});
        setIsConnected(false);
    };

    const value = { 
        resource, 
        pppoeActive, 
        activeInterfaces, 
        traffic, 
        isConnected,
        selectedDeviceId,
        setSelectedDeviceId: handleDeviceChange
    };
    
    return <MikrotikContext.Provider value={value}>{children}</MikrotikContext.Provider>;
};