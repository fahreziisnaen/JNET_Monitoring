'use client';

import React, { createContext, useContext, useState, useEffect, useRef, useMemo } from 'react';
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
    const [pppoeSecrets, setPppoeSecrets] = useState([]);
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
            if (ws.current && (ws.current.readyState === WebSocket.OPEN || ws.current.readyState === WebSocket.CONNECTING)) {
                ws.current.close();
                ws.current = null;
            }
            setIsConnected(false);
            setResource(null);
            setPppoeSecrets([]);
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
                    if (data.pppoeSecrets && Array.isArray(data.pppoeSecrets)) {
                        setPppoeSecrets(data.pppoeSecrets);
                    } else if (data.pppoeActive && Array.isArray(data.pppoeActive)) {
                        // Backward compatibility: jika masih ada pppoeActive dari snapshot, convert ke pppoeSecrets
                        const convertedSecrets = data.pppoeActive.map((active: any) => ({
                            name: active.name,
                            profile: active.profile || '',
                            'remote-address': active.address || null,
                            disabled: 'false',
                            isActive: true,
                            uptime: active.uptime || null,
                            currentAddress: active.address || null,
                            activeConnectionId: active['.id'] || undefined // Include .id untuk kick
                        }));
                        setPppoeSecrets(convertedSecrets);
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
            if (!selectedDeviceId) {
                console.log('[WebSocket] Skip connect - selectedDeviceId belum tersedia');
                return; // Wait for device selection
            }
            
            // Pastikan user sudah ada
            if (!user) {
                console.log('[WebSocket] Skip connect - user belum tersedia');
                return;
            }

            // Cek apakah sudah ada koneksi yang sedang connecting atau open
            if (ws.current) {
                const currentState = ws.current.readyState;
                if (currentState === WebSocket.CONNECTING) {
                    console.log('[WebSocket] Koneksi sedang dalam proses, skip');
                    return; // Jangan buat koneksi baru jika sedang connecting
                }
                
                if (currentState === WebSocket.OPEN) {
                // Check if device changed
                    try {
                const currentUrl = ws.current.url;
                        if (currentUrl) {
                            const urlObj = new URL(currentUrl);
                            const expectedDeviceId = urlObj.searchParams.get('deviceId');
                if (expectedDeviceId === selectedDeviceId.toString()) {
                                console.log('[WebSocket] Sudah terhubung ke device yang sama, skip');
                    return; // Same device, already connected
                } else {
                    // Device changed, close and reconnect
                    console.log('[WebSocket] Device berubah, menutup koneksi lama');
                    if (ws.current && (ws.current.readyState === WebSocket.OPEN || ws.current.readyState === WebSocket.CONNECTING)) {
                        ws.current.close();
                        ws.current = null;
                    }
                }
                        }
                    } catch (urlError) {
                        // Jika URL tidak valid, close dan reconnect
                        console.warn('[WebSocket] Error parsing URL, menutup koneksi:', urlError);
                        if (ws.current) {
                    ws.current.close();
                    ws.current = null;
                        }
                    }
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
                console.log('[WebSocket] Connecting dengan token dari localStorage/cookie, deviceId:', selectedDeviceId);
                
                // Tambahkan small delay untuk memastikan tidak ada race condition
                // Tapi jangan delay jika ini retry
                const socket = new WebSocket(wsUrlWithParams);
                ws.current = socket;

                // Set connection timeout untuk mencegah hanging
                const connectionTimeout = setTimeout(() => {
                    if (socket.readyState === WebSocket.CONNECTING) {
                        console.warn('[WebSocket] Connection timeout setelah 10 detik, menutup koneksi');
                        socket.close();
                    }
                }, 10000);

                socket.onopen = () => {
                    clearTimeout(connectionTimeout);
                    console.log("[WebSocket] Koneksi berhasil dibuat.");
                    setIsConnected(true);
                    reconnectAttempts = 0; // Reset counter setelah berhasil connect
                };

                socket.onclose = (event) => {
                    clearTimeout(connectionTimeout);
                    setIsConnected(false);
                    ws.current = null;
                    
                    // Log close reason jika ada
                    if (event.code !== 1000) { // 1000 = normal closure
                        console.warn(`[WebSocket] Koneksi ditutup dengan code ${event.code}, reason: ${event.reason || 'Tidak ada alasan'}`);
                    } else {
                    console.log('[WebSocket] Koneksi ditutup.');
                    }
                    
                    // Auto-reconnect jika masih ada user dan belum mencapai max attempts
                    // Jangan reconnect jika close code adalah 1008 (Unauthorized) atau 1003 (Invalid data)
                    if (user && reconnectAttempts < maxReconnectAttempts && event.code !== 1008 && event.code !== 1003) {
                        reconnectAttempts++;
                        console.log(`[WebSocket] Mencoba reconnect (${reconnectAttempts}/${maxReconnectAttempts}) dalam ${reconnectDelay/1000} detik...`);
                        reconnectTimeout = setTimeout(() => {
                            connectWebSocket();
                        }, reconnectDelay);
                    } else if (reconnectAttempts >= maxReconnectAttempts) {
                        console.error('[WebSocket] Gagal reconnect setelah beberapa kali percobaan.');
                    } else if (event.code === 1008 || event.code === 1003) {
                        console.error('[WebSocket] Koneksi ditolak oleh server (Unauthorized/Invalid), tidak akan reconnect.');
                    }
                };

                socket.onerror = (error) => {
                    clearTimeout(connectionTimeout);
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
                                pppoeSecretsCount: message.payload.pppoeSecrets?.length || 0,
                                activeCount: message.payload.pppoeSecrets?.filter((s: any) => s.isActive).length || 0,
                                activeInterfacesCount: message.payload.activeInterfaces?.length || 0,
                                trafficCount: Object.keys(message.payload.traffic || {}).length
                            });
                            setResource(message.payload.resource);
                            setPppoeSecrets(message.payload.pppoeSecrets || []);
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
        // Tambahkan small delay untuk memastikan state sudah ter-update
        if (selectedDeviceId && user) {
            // Cek apakah sudah ada koneksi yang valid
            if (ws.current) {
                const currentState = ws.current.readyState;
                if (currentState === WebSocket.OPEN || currentState === WebSocket.CONNECTING) {
                    // Sudah ada koneksi yang aktif atau sedang connecting
                    return;
                }
            }
            
            // Delay kecil untuk memastikan tidak ada race condition
            const connectTimeout = setTimeout(() => {
                if (selectedDeviceId && user && (!ws.current || ws.current.readyState === WebSocket.CLOSED)) {
            connectWebSocket();
                }
            }, 100); // 100ms delay
            
            return () => {
                clearTimeout(connectTimeout);
            };
        }

        return () => {
            if (reconnectTimeout) {
                clearTimeout(reconnectTimeout);
            }
            // Jangan close WebSocket di cleanup jika masih ada user dan deviceId
            // Biarkan WebSocket tetap hidup selama user masih login
            // Hanya close jika user logout atau deviceId dihapus
            if (ws.current && (!user || !selectedDeviceId)) {
                console.log('[WebSocket] Cleanup: Menutup WebSocket karena user atau deviceId tidak ada');
                if (ws.current.readyState === WebSocket.OPEN || ws.current.readyState === WebSocket.CONNECTING) {
                ws.current.close();
                }
                ws.current = null;
            }
        };
    }, [user, selectedDeviceId]);

    const handleDeviceChange = (deviceId: number | null) => {
        console.log('[MikrotikProvider] handleDeviceChange dipanggil dengan deviceId:', deviceId, 'current deviceId:', selectedDeviceId);
        
        // Jika deviceId sama, tidak perlu melakukan apapun
        if (deviceId === selectedDeviceId) {
            console.log('[MikrotikProvider] DeviceId sama, skip');
            return;
        }
        
        // Close WebSocket to reconnect with new device
        // Tapi jangan close jika masih CONNECTING (tunggu sampai OPEN atau CLOSED)
        if (ws.current) {
            const currentState = ws.current.readyState;
            
            if (currentState === WebSocket.OPEN) {
                console.log('[MikrotikProvider] Menutup WebSocket yang OPEN sebelum change device');
                ws.current.close(1000, 'Device changed'); // Normal closure
                ws.current = null;
            } else if (currentState === WebSocket.CONNECTING) {
                // Tunggu sampai CONNECTING selesai, baru close
                console.log('[MikrotikProvider] WebSocket masih CONNECTING, akan close setelah open');
                const checkAndClose = () => {
                    if (ws.current) {
                        const state = ws.current.readyState;
                        if (state === WebSocket.OPEN) {
                            console.log('[MikrotikProvider] WebSocket sekarang OPEN, menutup...');
                            ws.current.close(1000, 'Device changed');
                            ws.current = null;
                        } else if (state === WebSocket.CONNECTING) {
                            // Masih connecting, coba lagi setelah 100ms
                            setTimeout(checkAndClose, 100);
                        } else {
                            // Sudah CLOSED atau CLOSING, clear saja
                            ws.current = null;
                        }
                    }
                };
                
                // Set timeout maksimal 5 detik untuk menunggu
                setTimeout(() => {
                    if (ws.current && ws.current.readyState === WebSocket.CONNECTING) {
                        console.warn('[MikrotikProvider] WebSocket masih CONNECTING setelah 5 detik, force close');
            ws.current.close();
            ws.current = null;
        }
                }, 5000);
                
                // Mulai check setelah 200ms
                setTimeout(checkAndClose, 200);
            } else {
                // CLOSED atau CLOSING, clear saja
                ws.current = null;
            }
        }
        
        // Clear data
        setResource(null);
        setPppoeSecrets([]);
        setActiveInterfaces([]);
        setTraffic({});
        setIsConnected(false);
        
        // Set deviceId setelah clear data dan close WebSocket
        setSelectedDeviceId(deviceId);
        
        if (user?.workspace_id && deviceId) {
            localStorage.setItem(`selected-device-${user.workspace_id}`, deviceId.toString());
        }
    };

    // Helper: dapatkan pppoeActive dari pppoeSecrets yang isActive = true (untuk backward compatibility)
    const pppoeActive = useMemo(() => {
        return pppoeSecrets.filter((secret: any) => secret.isActive === true);
    }, [pppoeSecrets]);

    const value = { 
        resource, 
        pppoeActive, // Backward compatibility: derived dari pppoeSecrets
        pppoeSecrets,
        activeInterfaces, 
        traffic, 
        isConnected,
        selectedDeviceId,
        setSelectedDeviceId: handleDeviceChange
    };
    
    return <MikrotikContext.Provider value={value}>{children}</MikrotikContext.Provider>;
};