'use client';

import React, { createContext, useContext, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useAuth } from './auth-provider';
import { apiFetch, getAuthToken } from '@/utils/api';

interface DeviceData {
    pppoeSecrets: any[];
    hotspotActive: any[];
    resource: any;
    activeInterfaces: Array<{ name: string; type: string; running: boolean }>;
    traffic: any;
    isConnected: boolean;
    workspaceId?: number;
}

interface MikrotikContextType {
    allDevicesData: Record<number, DeviceData>;
    allDevicesStatus: Record<number, { isConnected: boolean }>;
    selectedDeviceIds: number[];
    setSelectedDeviceIds: (deviceIds: number[]) => void;
    selectedDeviceId: number | null;
    setSelectedDeviceId: (deviceId: number) => void;
    isLoaded: boolean;
    pppoeSecrets: any[];
    hotspotActive: any[];
    resource: any;
    isConnected: boolean;
    toggleDeviceId: (deviceId: number) => void;
    forceRefresh: (deviceId?: number) => void;
    getDeviceWorkspaceId: (deviceId: number) => number | null;
}

const MikrotikContext = createContext<MikrotikContextType | null>(null);

export const useMikrotik = () => {
    const context = useContext(MikrotikContext);
    if (!context) {
        throw new Error('useMikrotik must be used within a MikrotikProvider');
    }
    return context;
};

const DEFAULT_DEVICE_DATA: DeviceData = {
    pppoeSecrets: [],
    hotspotActive: [],
    resource: null,
    activeInterfaces: [],
    traffic: {},
    isConnected: false,
    workspaceId: undefined,
};

export const MikrotikProvider = ({ children }: { children: React.ReactNode }) => {
    const { user } = useAuth();
    const [dashboardDeviceIds, setDashboardDeviceIds] = useState<number[]>([]);
    const [activeDeviceId, setActiveDeviceId] = useState<number | null>(null);
    const [isLoaded, setIsLoaded] = useState(false);

    // Per-device data stored in ref to avoid excessive re-renders
    const deviceDataRef = useRef<Map<number, DeviceData>>(new Map());
    // Per-device WS pool
    const wsPoolRef = useRef<Map<number, WebSocket>>(new Map());
    // Per-device reconnect timeouts
    const reconnectTimersRef = useRef<Map<number, any>>(new Map());
    // Per-device reconnect attempt counters
    const reconnectAttemptsRef = useRef<Map<number, number>>(new Map());
    // Ref to selectedDeviceIds so callbacks don't need it as a dep (prevents reconnect loops)
    const selectedDeviceIdsRef = useRef<number[]>([]);

    // Tick counter: increment to trigger re-render when device data changes
    const [tick, setTick] = useState(0);
    const triggerRender = useCallback(() => setTick(t => t + 1), []);

    // Union of both selections for WebSocket management
    const effectiveSelectedIds = useMemo(() => {
        const ids = new Set(dashboardDeviceIds);
        if (activeDeviceId) ids.add(activeDeviceId);
        return Array.from(ids);
    }, [dashboardDeviceIds, activeDeviceId]);

    // Keep selectedDeviceIdsRef in sync with the UNION of all needed connections
    useEffect(() => {
        selectedDeviceIdsRef.current = effectiveSelectedIds;
    }, [effectiveSelectedIds]);

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
                        hotspotActive: payload.hotspotActive || [],
                        resource: hasResource ? payload.resource : prev.resource,
                        activeInterfaces: hasInterfaces ? payload.activeInterfaces : prev.activeInterfaces,
                        traffic: hasTraffic ? payload.traffic : prev.traffic,
                        isConnected: true, // Pastikan connected jika ada data batch
                    });
                } else if (message.type === 'pppoe-update' && message.payload) {
                    const newSecrets = message.payload.pppoeSecrets || [];
                    // Only update pppoeSecrets — pppoe-update never carries a status field,
                    // so do NOT read message.payload.status here (it would always be falsy → isConnected: false).
                    // isConnected is managed exclusively by connection-status messages.
                    if (JSON.stringify(newSecrets) !== JSON.stringify(prev.pppoeSecrets)) {
                        updateDeviceData(deviceId, { pppoeSecrets: newSecrets });
                    }
                } else if (message.type === 'connection-status' && message.payload) {
                    const connected = message.payload.status === 'connected';
                    updateDeviceData(deviceId, { isConnected: connected });
                    
                    // Forward event for toast notifications
                    if (selectedDeviceIdsRef.current.includes(deviceId)) {
                        window.dispatchEvent(new CustomEvent('mikrotik-connection-status', {
                            detail: message.payload
                        }));
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
            wsPoolRef.current.delete(deviceId);

            // Only update state & notify if device is still selected (avoid stale updates for deselected devices)
            const isStillSelected = selectedDeviceIdsRef.current.includes(deviceId);
            if (isStillSelected) {
                updateDeviceData(deviceId, { isConnected: false });
                window.dispatchEvent(new CustomEvent('mikrotik-connection-status', {
                    detail: { status: 'disconnected', message: event.reason || 'Koneksi terputus', code: event.code }
                }));
            }

            // Auto reconnect only if device is still selected, user is still logged in,
            // and the close was not intentional (code 1000=normal, 1008=policy/auth)
            const attempts = reconnectAttemptsRef.current.get(deviceId) || 0;
            const maxAttempts = 5;
            if (
                isStillSelected &&
                user &&
                attempts < maxAttempts &&
                event.code !== 1008 &&
                event.code !== 1003 &&
                event.code !== 1000
            ) {
                reconnectAttemptsRef.current.set(deviceId, attempts + 1);
                const timer = setTimeout(() => {
                    if (user && selectedDeviceIdsRef.current.includes(deviceId)) {
                        connectDevice(deviceId, workspaceId);
                    }
                }, 3000);
                reconnectTimersRef.current.set(deviceId, timer);
            }
        };

        socket.onerror = () => {
            clearTimeout(connTimeout);
            if (socket.readyState === WebSocket.CLOSING || socket.readyState === WebSocket.CLOSED) return;
            // Only update state if device is still selected
            if (selectedDeviceIdsRef.current.includes(deviceId)) {
                updateDeviceData(deviceId, { isConnected: false });
            }
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [updateDeviceData, user])

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
            ? `${apiUrl}/api/dashboard/snapshot?summary=true` 
            : `${apiUrl}/api/dashboard/snapshot?summary=true&workspaceId=${user.workspace_id}`;

        // 1. Fetch ALL snapshots for the workspace for instant data
        apiFetch(snapshotUrl)
            .then(res => res.ok ? res.json() : [])
            .then((snapshots: any[]) => {
                if (Array.isArray(snapshots)) {
                    snapshots.forEach(s => {
                        deviceDataRef.current.set(s.deviceId, {
                            pppoeSecrets: s.pppoeSecrets || [],
                            hotspotActive: s.hotspotActive || [],
                            resource: s.resource,
                            activeInterfaces: s.activeInterfaces || [],
                            traffic: s.traffic || {},
                            isConnected: s.isConnected || false,
                            workspaceId: s.workspace_id,
                        });
                    });
                }
                
                // 2. Fetch ALL authorized devices to build a reliable Workspace ID mapping
                // This is crucial for Superadmins when selecting a device from another workspace
                return apiFetch(`${apiUrl}/api/devices`);
            })
            .then(res => res.ok ? res.json() : [])
            .then((devices: any[]) => {
                if (Array.isArray(devices)) {
                    devices.forEach(d => {
                        const existing = deviceDataRef.current.get(d.id) || { ...DEFAULT_DEVICE_DATA };
                        deviceDataRef.current.set(d.id, {
                            ...existing,
                            workspaceId: d.workspace_id
                        });
                    });
                }
                triggerRender();

                // 3. Load selections from localStorage
                const dashboardSaved = localStorage.getItem(`dashboard-devices-${user.workspace_id}`);
                const activeSaved = localStorage.getItem(`active-device-${user.workspace_id}`);

                if (dashboardSaved) {
                    try {
                        const ids = JSON.parse(dashboardSaved);
                        if (Array.isArray(ids)) setDashboardDeviceIds(ids.filter(id => !isNaN(id)));
                    } catch (e) { console.error('Failed to parse dashboard device IDs:', e); }
                }

                if (activeSaved) {
                    try {
                        const id = JSON.parse(activeSaved);
                        if (typeof id === 'number' && !isNaN(id)) setActiveDeviceId(id);
                    } catch (e) { console.error('Failed to parse active device ID:', e); }
                }
                setIsLoaded(true);
            })
            .catch(err => {
                console.error('[MikrotikProvider] Error fetching initial snapshots:', err);
                setIsLoaded(true); // Still mark as loaded to let UI proceed
            });
    }, [user?.workspace_id, triggerRender]);

    // Connection Manager: maintain WS for the UNION of both selections
    useEffect(() => {
        if (!isLoaded || !user?.workspace_id) return;

        const currentSelected = new Set(effectiveSelectedIds);
        const activeTimers: any[] = [];
        
        // 1. Close connections for unselected devices
        wsPoolRef.current.forEach((ws, deviceId) => {
            if (!currentSelected.has(deviceId)) {
                ws.close(1000, 'Unselected');
                wsPoolRef.current.delete(deviceId);
                const timer = reconnectTimersRef.current.get(deviceId);
                if (timer) clearTimeout(timer);
                reconnectTimersRef.current.delete(deviceId);
                reconnectAttemptsRef.current.delete(deviceId);
            }
        });

        // 2. Open connections for needed devices (staggered)
        effectiveSelectedIds.forEach((id, index) => {
            if (!wsPoolRef.current.has(id)) {
                const timer = setTimeout(() => {
                    const devData = deviceDataRef.current.get(id);
                    const wsWorkspaceId = devData?.workspaceId || user.workspace_id;
                    if (user?.workspace_id) connectDevice(id, wsWorkspaceId);
                }, index * 300);
                reconnectTimersRef.current.set(id, timer);
                activeTimers.push(timer);
            }
        });

        return () => activeTimers.forEach(t => clearTimeout(t));
    }, [effectiveSelectedIds, isLoaded, user?.workspace_id, connectDevice]);

    // Setters for Dashboard (Multiple)
    const handleDashboardChange = useCallback((deviceIds: number[]) => {
        setDashboardDeviceIds(deviceIds);
        if (user?.workspace_id) {
            localStorage.setItem(`dashboard-devices-${user.workspace_id}`, JSON.stringify(deviceIds));
        }
    }, [user?.workspace_id]);

    const toggleDashboardId = useCallback((deviceId: number) => {
        setDashboardDeviceIds(prev => {
            const next = prev.includes(deviceId) ? prev.filter(id => id !== deviceId) : [...prev, deviceId];
            if (user?.workspace_id) {
                localStorage.setItem(`dashboard-devices-${user.workspace_id}`, JSON.stringify(next));
            }
            return next;
        });
    }, [user?.workspace_id]);

    // Setter for Active Management (Singular)
    const handleActiveChange = useCallback((deviceId: number) => {
        setActiveDeviceId(deviceId);
        if (user?.workspace_id) {
            localStorage.setItem(`active-device-${user.workspace_id}`, JSON.stringify(deviceId));
            
            // OPTIONAL: Fetch full snapshot for this specific device if not already loaded
            const current = deviceDataRef.current.get(deviceId);
            if (!current || !current.pppoeSecrets || current.pppoeSecrets.length === 0) {
                const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
                apiFetch(`${apiUrl}/api/dashboard/snapshot?deviceId=${deviceId}&workspaceId=${current?.workspaceId || user.workspace_id}`)
                    .then(res => res.ok ? res.json() : null)
                    .then(data => {
                        if (data) {
                            updateDeviceData(deviceId, {
                                pppoeSecrets: data.pppoeSecrets || [],
                                hotspotActive: data.hotspotActive || [],
                                resource: data.resource,
                                isConnected: data.isConnected
                            });
                        }
                    })
                    .catch(err => console.error('[MikrotikProvider] Lazy fetch error:', err));
            }
        }
    }, [user?.workspace_id, updateDeviceData]);

    // Derive aggregated data for context
    const allDevicesData = useMemo(() => {
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        tick; // depend on tick so useMemo re-runs when device data updates
        
        const dataMap: Record<number, DeviceData> = {};
        deviceDataRef.current.forEach((data, id) => {
            dataMap[id] = data;
        });

        const allDevicesStatus: Record<number, { isConnected: boolean }> = {};
        deviceDataRef.current.forEach((data, id) => {
            allDevicesStatus[id] = { isConnected: data.isConnected };
        });

        return { dataMap, allDevicesStatus };
    }, [tick]);

    const forceRefresh = useCallback((deviceId?: number) => {
        const targetIds = deviceId ? [deviceId] : effectiveSelectedIds;
        targetIds.forEach(id => {
            const ws = wsPoolRef.current.get(id);
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'force-refresh', target: 'secrets' }));
            }
        });
    }, [effectiveSelectedIds]);

    const getDeviceWorkspaceId = useCallback((deviceId: number) => {
        return deviceDataRef.current.get(deviceId)?.workspaceId || null;
    }, []);

    const activeDataId = activeDeviceId || dashboardDeviceIds[0] || null;

    const value: MikrotikContextType = {
        allDevicesData: allDevicesData.dataMap,
        allDevicesStatus: allDevicesData.allDevicesStatus,
        selectedDeviceIds: dashboardDeviceIds,
        setSelectedDeviceIds: handleDashboardChange,
        selectedDeviceId: activeDeviceId || dashboardDeviceIds[0] || null,
        setSelectedDeviceId: handleActiveChange,
        isLoaded,
        pppoeSecrets: activeDataId ? (allDevicesData.dataMap[activeDataId]?.pppoeSecrets || []) : [],
        hotspotActive: activeDataId ? (allDevicesData.dataMap[activeDataId]?.hotspotActive || []) : [],
        resource: activeDataId ? (allDevicesData.dataMap[activeDataId]?.resource || null) : null,
        isConnected: activeDataId ? (allDevicesData.dataMap[activeDataId]?.isConnected || false) : false,
        toggleDeviceId: toggleDashboardId,
        forceRefresh,
        getDeviceWorkspaceId,
    };

    return <MikrotikContext.Provider value={value}>{children}</MikrotikContext.Provider>;
};