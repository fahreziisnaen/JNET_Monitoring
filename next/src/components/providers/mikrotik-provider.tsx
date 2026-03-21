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
    const [selectedDeviceIds, setSelectedDeviceIds] = useState<number[]>([]);
    const [isLoaded, setIsLoaded] = useState(false);

    // Per-device data stored in ref to avoid excessive re-renders
    const deviceDataRef = useRef<Map<number, DeviceData>>(new Map());
    // Per-device WS pool
    const wsPoolRef = useRef<Map<number, WebSocket>>(new Map());
    // Per-device reconnect timeouts
    const reconnectTimersRef = useRef<Map<number, any>>(new Map());
    // Per-device reconnect attempt counters
    const reconnectAttemptsRef = useRef<Map<number, number>>(new Map());

    // Tick counter: increment to trigger re-render when device data changes
    const [tick, setTick] = useState(0);
    const triggerRender = useCallback(() => setTick(t => t + 1), []);

    // handleDeviceData: update internal ref and trigger render
    const updateDeviceData = useCallback((deviceId: number, data: Partial<DeviceData>) => {
        const prev = deviceDataRef.current.get(deviceId) || { ...DEFAULT_DEVICE_DATA };
        deviceDataRef.current.set(deviceId, {
            ...prev,
            ...data
        });
        triggerRender();
    }, [triggerRender]);

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

                    updateDeviceData(deviceId, {
                        pppoeSecrets: payload.pppoeSecrets || [],
                        resource: hasResource ? payload.resource : prev.resource,
                        activeInterfaces: hasInterfaces ? payload.activeInterfaces : prev.activeInterfaces,
                        traffic: hasTraffic ? payload.traffic : prev.traffic,
                        isConnected: true, // Pastikan connected jika ada data batch
                    });
                } else if (message.type === 'pppoe-update' && message.payload) {
                    const newSecrets = message.payload.pppoeSecrets || [];
                    if (JSON.stringify(newSecrets) !== JSON.stringify(prev.pppoeSecrets)) {
                        updateDeviceData(deviceId, { pppoeSecrets: newSecrets, isConnected: true });
                    }
                    const connected = message.payload.status === 'connected';
                    updateDeviceData(deviceId, { isConnected: connected });

                    // Forward event for toast notifications (if device is selected)
                    if (selectedDeviceIds.includes(deviceId)) {
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
            updateDeviceData(deviceId, { isConnected: false });
            wsPoolRef.current.delete(deviceId);

            // Forward disconnect if device is selected
            if (selectedDeviceIds.includes(deviceId)) {
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
            updateDeviceData(deviceId, { isConnected: false });
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [updateDeviceData, user, selectedDeviceIds]);

    // Initial load: Fetch all snapshots for the workspace at once
    useEffect(() => {
        if (!user?.workspace_id) {
            setIsLoaded(false);
            // Cleanup all connections on logout
            wsPoolRef.current.forEach((ws) => ws.close(1000, 'Logout'));
            wsPoolRef.current.clear();
            deviceDataRef.current.clear();
            reconnectTimersRef.current.forEach(t => clearTimeout(t));
            reconnectTimersRef.current.clear();
            reconnectAttemptsRef.current.clear();
            setTick(0);
            return;
        }

        const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
        const isSuper = user.is_super_admin === 1 || user.is_super_admin === true;
        const snapshotUrl = isSuper 
            ? `${apiUrl}/api/dashboard/snapshot` 
            : `${apiUrl}/api/dashboard/snapshot?workspaceId=${user.workspace_id}`;

        // 1. Fetch ALL snapshots for the workspace in ONE request
        apiFetch(snapshotUrl)
            .then(res => res.ok ? res.json() : [])
            .then((snapshots: any[]) => {
                if (Array.isArray(snapshots)) {
                    snapshots.forEach(s => {
                        deviceDataRef.current.set(s.deviceId, {
                            pppoeSecrets: s.pppoeSecrets || [],
                            resource: s.resource,
                            activeInterfaces: s.activeInterfaces || [],
                            traffic: s.traffic || {},
                            isConnected: s.isConnected || false,
                        });
                    });
                    triggerRender();
                }
                
                // 2. Load selected devices from localStorage
                const saved = localStorage.getItem(`selected-devices-v2-${user.workspace_id}`);
                if (saved) {
                    try {
                        const ids = JSON.parse(saved);
                        if (Array.isArray(ids)) {
                            setSelectedDeviceIds(ids.filter(id => !isNaN(id)));
                        } else if (typeof ids === 'number') {
                            setSelectedDeviceIds([ids]);
                        }
                    } catch (e) { console.error('Failed to parse saved device IDs:', e); }
                }
                setIsLoaded(true);
            })
            .catch(err => {
                console.error('[MikrotikProvider] Error fetching initial snapshots:', err);
                setIsLoaded(true); // Still mark as loaded to let UI proceed
            });
    }, [user?.workspace_id, triggerRender]);

    // Connection Manager: Only connect/maintain WS for selected devices
    useEffect(() => {
        if (!isLoaded || !user?.workspace_id) return;

        const currentSelected = new Set(selectedDeviceIds);
        const activeTimers: any[] = [];
        
        // 1. Close connections for unselected devices
        wsPoolRef.current.forEach((ws, deviceId) => {
            if (!currentSelected.has(deviceId)) {
                ws.close(1000, 'Unselected');
                wsPoolRef.current.delete(deviceId);
                const timer = reconnectTimersRef.current.get(deviceId);
                if (timer) clearTimeout(timer);
                reconnectTimersRef.current.delete(deviceId); // Clear any pending reconnect timers
                reconnectAttemptsRef.current.delete(deviceId); // Reset attempts
            }
        });

        // 2. Open connections for newly selected devices (staggered)
        selectedDeviceIds.forEach((id, index) => {
            if (!wsPoolRef.current.has(id)) {
                // Stagger connections
                const timer = setTimeout(() => {
                    if (user?.workspace_id) { // Ensure user is still logged in
                        connectDevice(id, user.workspace_id);
                    }
                }, index * 300); // 300ms stagger is enough for lazy load
                reconnectTimersRef.current.set(id, timer); // Store timer to clear if device becomes unselected
                activeTimers.push(timer);
            }
        });

        return () => {
            // Clear any timers that were set in this effect run
            activeTimers.forEach(t => clearTimeout(t));
        };
    }, [selectedDeviceIds, isLoaded, user?.workspace_id, connectDevice]);

    // handleDeviceChange: handle array of deviceIds
    const handleDevicesChange = useCallback((deviceIds: number[]) => {
        setSelectedDeviceIds(deviceIds);
        if (user?.workspace_id) {
            localStorage.setItem(`selected-devices-v2-${user.workspace_id}`, JSON.stringify(deviceIds));
        }
    }, [user?.workspace_id]);

    const toggleDeviceId = useCallback((deviceId: number) => {
        setSelectedDeviceIds(prev => {
            const next = prev.includes(deviceId) 
                ? prev.filter(id => id !== deviceId)
                : [...prev, deviceId];
            
            if (user?.workspace_id) {
                localStorage.setItem(`selected-devices-v2-${user.workspace_id}`, JSON.stringify(next));
            }
            return next;
        });
    }, [user?.workspace_id]);

    // setSelectedDeviceId (singular) for backward compatibility
    const handleDeviceChange = useCallback((deviceId: number) => {
        handleDevicesChange([deviceId]);
    }, [handleDevicesChange]);

    // Derive aggregated data for context
    const allDevicesData = useMemo(() => {
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        tick; // depend on tick so useMemo re-runs when device data updates
        
        const dataMap: Record<number, DeviceData> = {};
        deviceDataRef.current.forEach((data, id) => {
            dataMap[id] = data;
        });

        const allStatus: Record<number, { isConnected: boolean }> = {};
        deviceDataRef.current.forEach((data, id) => {
            allStatus[id] = { isConnected: data.isConnected };
        });

        return { dataMap, allStatus };
    }, [tick]);

    const forceRefresh = useCallback((deviceId?: number) => {
        const targetIds = deviceId ? [deviceId] : selectedDeviceIds;
        targetIds.forEach(id => {
            const ws = wsPoolRef.current.get(id);
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'force-refresh', target: 'secrets' }));
            }
        });
    }, [selectedDeviceIds]);

    const value = {
        allDevicesData: allDevicesData.dataMap,
        allStatus: allDevicesData.allStatus,
        selectedDeviceIds,
        setSelectedDeviceIds: handleDevicesChange,
        selectedDeviceId: selectedDeviceIds[0] || null,
        setSelectedDeviceId: handleDeviceChange,
        isLoaded,
        pppoeSecrets: selectedDeviceIds[0] ? (allDevicesData.dataMap[selectedDeviceIds[0]]?.pppoeSecrets || []) : [],
        resource: selectedDeviceIds[0] ? (allDevicesData.dataMap[selectedDeviceIds[0]]?.resource || null) : null,
        isConnected: selectedDeviceIds[0] ? (allDevicesData.dataMap[selectedDeviceIds[0]]?.isConnected || false) : false,
        toggleDeviceId,
        forceRefresh,
    };

    return <MikrotikContext.Provider value={value}>{children}</MikrotikContext.Provider>;
};