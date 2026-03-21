'use client';

import React, { createContext, useContext, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useAuth } from './auth-provider';
import { apiFetch, getAuthToken } from '@/utils/api';

const MikrotikContext = createContext<any>(null);

export const useMikrotik = () => {
    return useContext(MikrotikContext);
};

interface DeviceData {
    pppoeSecrets: any[];
    resource: any;
    activeInterfaces: Array<{ name: string; type: string; running: boolean }>;
    traffic: any;
    isConnected: boolean;
}

const DEFAULT_DEVICE_DATA: DeviceData = {
    pppoeSecrets: [],
    resource: null,
    activeInterfaces: [],
    traffic: {},
    isConnected: false,
};

export const MikrotikProvider = ({ children }: { children: React.ReactNode }) => {
    const { user } = useAuth();
    const [selectedDeviceId, setSelectedDeviceId] = useState<number | null>(null);

    // Per-device data stored in ref to avoid excessive re-renders
    const deviceDataRef = useRef<Map<number, DeviceData>>(new Map());
    // Per-device WS pool
    const wsPoolRef = useRef<Map<number, WebSocket>>(new Map());
    // Per-device reconnect timeouts
    const reconnectTimersRef = useRef<Map<number, NodeJS.Timeout>>(new Map());
    // Per-device reconnect attempt counters
    const reconnectAttemptsRef = useRef<Map<number, number>>(new Map());

    // Tick counter: increment to trigger re-render when device data changes
    const [tick, setTick] = useState(0);
    const triggerRender = useCallback(() => setTick(t => t + 1), []);

    // Load selected device from localStorage
    useEffect(() => {
        if (user?.workspace_id) {
            const saved = localStorage.getItem(`selected-device-${user.workspace_id}`);
            if (saved) {
                try {
                    const deviceId = parseInt(saved);
                    if (!isNaN(deviceId)) setSelectedDeviceId(deviceId);
                } catch (e) {
                    console.error('Failed to parse saved device ID:', e);
                }
            }
        }
    }, [user]);

    // Connect a single device WebSocket
    const connectDevice = useCallback((deviceId: number, workspaceId: number) => {
        // Already connected or connecting?
        const existing = wsPoolRef.current.get(deviceId);
        if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
            return;
        }

        const wsUrl = process.env.NEXT_PUBLIC_WS_BASE_URL;
        if (!wsUrl) return;

        const token = getAuthToken();
        if (!token) return;

        const wsUrlWithParams = `${wsUrl}?deviceId=${deviceId}&workspaceId=${workspaceId}&token=${encodeURIComponent(token)}`;
        let socket: WebSocket;
        try {
            socket = new WebSocket(wsUrlWithParams);
        } catch (e) {
            console.error(`[WS Pool] Error creating socket for device ${deviceId}:`, e);
            return;
        }
        wsPoolRef.current.set(deviceId, socket);

        // Connection timeout
        const connTimeout = setTimeout(() => {
            if (socket.readyState === WebSocket.CONNECTING) {
                console.warn(`[WS Pool] Timeout connecting device ${deviceId}`);
                socket.close();
            }
        }, 10000);

        socket.onopen = () => {
            clearTimeout(connTimeout);
            reconnectAttemptsRef.current.set(deviceId, 0);
            console.log(`[WS Pool] Device ${deviceId} connected`);
        };

        socket.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                const prev = deviceDataRef.current.get(deviceId) || { ...DEFAULT_DEVICE_DATA };

                if (message.type === 'batch-update' && message.payload) {
                    const payload = message.payload;
                    const hasResource = payload.resource && Object.keys(payload.resource).length > 0;
                    const hasInterfaces = payload.activeInterfaces && payload.activeInterfaces.length > 0;
                    const hasTraffic = payload.traffic && Object.keys(payload.traffic).length > 0;

                    deviceDataRef.current.set(deviceId, {
                        pppoeSecrets: payload.pppoeSecrets || [],
                        resource: hasResource ? payload.resource : prev.resource,
                        activeInterfaces: hasInterfaces ? payload.activeInterfaces : prev.activeInterfaces,
                        traffic: hasTraffic ? payload.traffic : prev.traffic,
                        isConnected: true, // Pastikan connected jika ada data batch
                    });
                    triggerRender();
                } else if (message.type === 'pppoe-update' && message.payload) {
                    const newSecrets = message.payload.pppoeSecrets || [];
                    if (JSON.stringify(newSecrets) !== JSON.stringify(prev.pppoeSecrets)) {
                        deviceDataRef.current.set(deviceId, { ...prev, pppoeSecrets: newSecrets, isConnected: true });
                        triggerRender();
                    }
                } else if (message.type === 'connection-status' && message.payload) {
                    const connected = message.payload.status === 'connected';
                    deviceDataRef.current.set(deviceId, { ...prev, isConnected: connected });
                    triggerRender();

                    // Forward event for toast notifications (only for selected device)
                    if (deviceId === selectedDeviceId) {
                        window.dispatchEvent(new CustomEvent('mikrotik-connection-status', {
                            detail: message.payload
                        }));
                    }

                    // Force refresh on reconnect
                    if (connected) {
                        const ws = wsPoolRef.current.get(deviceId);
                        if (ws && ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({ type: 'force-refresh', target: 'secrets' }));
                        }
                    }
                } else if (message.type === 'downtime-notification' && message.payload) {
                    window.dispatchEvent(new CustomEvent('downtime-notification', { detail: message.payload }));
                } else if (message.type === 'reconnect-notification' && message.payload) {
                    window.dispatchEvent(new CustomEvent('reconnect-notification', { detail: message.payload }));
                }
            } catch (e) {
                console.error(`[WS Pool] Parse error device ${deviceId}:`, e);
            }
        };

        socket.onclose = (event) => {
            clearTimeout(connTimeout);
            const prev = deviceDataRef.current.get(deviceId) || { ...DEFAULT_DEVICE_DATA };
            deviceDataRef.current.set(deviceId, { ...prev, isConnected: false });
            wsPoolRef.current.delete(deviceId);
            triggerRender();

            // Forward disconnect for selected device
            if (deviceId === selectedDeviceId) {
                window.dispatchEvent(new CustomEvent('mikrotik-connection-status', {
                    detail: { status: 'disconnected', message: event.reason || 'Koneksi terputus', code: event.code }
                }));
            }

            // Auto reconnect (if not intentional close like logout)
            const attempts = reconnectAttemptsRef.current.get(deviceId) || 0;
            const maxAttempts = 5;
            if (user && attempts < maxAttempts && event.code !== 1008 && event.code !== 1003 && event.code !== 1000) {
                reconnectAttemptsRef.current.set(deviceId, attempts + 1);
                const timer = setTimeout(() => {
                    if (user) connectDevice(deviceId, workspaceId);
                }, 3000);
                reconnectTimersRef.current.set(deviceId, timer);
            }
        };

        socket.onerror = () => {
            clearTimeout(connTimeout);
            if (socket.readyState === WebSocket.CLOSING || socket.readyState === WebSocket.CLOSED) return;
            const prev = deviceDataRef.current.get(deviceId) || { ...DEFAULT_DEVICE_DATA };
            deviceDataRef.current.set(deviceId, { ...prev, isConnected: false });
            triggerRender();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [triggerRender, user]);

    // On login: fetch devices and connect all (with stagger to avoid race conditions)
    useEffect(() => {
        if (!user?.workspace_id) {
            // Cleanup on logout
            wsPoolRef.current.forEach((ws) => {
                if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close(1000, 'Logout');
            });
            wsPoolRef.current.clear();
            deviceDataRef.current.clear();
            reconnectTimersRef.current.forEach(t => clearTimeout(t));
            reconnectTimersRef.current.clear();
            reconnectAttemptsRef.current.clear();
            setTick(0);
            return;
        }

        const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
        const staggerTimers: NodeJS.Timeout[] = [];

        apiFetch(`${apiUrl}/api/devices`)
            .then(res => res.ok ? res.json() : [])
            .then((devices: any[]) => {
                if (!Array.isArray(devices)) return;
                devices.forEach((device: any, index: number) => {
                    if (!device.id || !device.workspace_id) return;

                    // Load snapshot with explicit workspaceId
                    apiFetch(`${apiUrl}/api/dashboard/snapshot?deviceId=${device.id}&workspaceId=${device.workspace_id}`)
                        .then(res => res.ok ? res.json() : null)
                        .then(data => {
                            if (!data) return;
                            const prev = deviceDataRef.current.get(device.id) || { ...DEFAULT_DEVICE_DATA };
                            deviceDataRef.current.set(device.id, {
                                pppoeSecrets: data.pppoeSecrets || prev.pppoeSecrets,
                                resource: data.resource || prev.resource,
                                activeInterfaces: data.activeInterfaces || prev.activeInterfaces,
                                traffic: data.traffic || prev.traffic,
                                isConnected: data.deviceStatus === 'connected',
                            });
                            triggerRender();
                        })
                        .catch(() => {});

                    // Connect WS with explicit workspaceId
                    const timer = setTimeout(() => {
                        if (user) connectDevice(device.id, device.workspace_id);
                    }, index * 800);
                    staggerTimers.push(timer);
                });
            })
            .catch(err => console.error('[WS Pool] Error fetching devices:', err));

        return () => {
            staggerTimers.forEach(t => clearTimeout(t));
            // On unmount / user change: close all WS
            wsPoolRef.current.forEach((ws) => {
                if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close(1000, 'Unmount');
            });
            wsPoolRef.current.clear();
            reconnectTimersRef.current.forEach(t => clearTimeout(t));
            reconnectTimersRef.current.clear();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.workspace_id]);

    // handleDeviceChange: ONLY update selectedDeviceId, no WS operations
    const handleDeviceChange = useCallback((deviceId: number | null) => {
        if (deviceId === selectedDeviceId) return;
        setSelectedDeviceId(deviceId);
        if (user?.workspace_id && deviceId) {
            localStorage.setItem(`selected-device-${user.workspace_id}`, deviceId.toString());
        }
    }, [selectedDeviceId, user?.workspace_id]);

    // Derive current device data for context
    const { currentData, allDevicesStatus } = useMemo(() => {
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        tick; // depend on tick so useMemo re-runs when device data updates
        const current = selectedDeviceId === null ? { ...DEFAULT_DEVICE_DATA } : (deviceDataRef.current.get(selectedDeviceId) || { ...DEFAULT_DEVICE_DATA });
        
        const allStatus: Record<number, { isConnected: boolean }> = {};
        deviceDataRef.current.forEach((data, id) => {
            allStatus[id] = { isConnected: data.isConnected };
        });

        return { currentData: current, allDevicesStatus: allStatus };
    }, [selectedDeviceId, tick]);

    const pppoeActive = useMemo(() => {
        return currentData.pppoeSecrets.filter((s: any) => s.isActive === true);
    }, [currentData.pppoeSecrets]);

    const forceRefresh = useCallback(() => {
        if (!selectedDeviceId) return;
        const ws = wsPoolRef.current.get(selectedDeviceId);
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'force-refresh', target: 'secrets' }));
        }
    }, [selectedDeviceId]);

    const value = {
        resource: currentData.resource,
        pppoeActive,
        pppoeSecrets: currentData.pppoeSecrets,
        activeInterfaces: currentData.activeInterfaces,
        traffic: currentData.traffic,
        isConnected: currentData.isConnected,
        selectedDeviceId,
        setSelectedDeviceId: handleDeviceChange,
        forceRefresh,
        allDevicesStatus,
    };

    return <MikrotikContext.Provider value={value}>{children}</MikrotikContext.Provider>;
};