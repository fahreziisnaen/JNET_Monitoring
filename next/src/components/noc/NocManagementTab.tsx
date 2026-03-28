'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion } from '@/components/motion';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Power, PowerOff, Loader2, Search, ArrowUpDown, ChevronUp, ChevronDown, Users, UserCheck, UserX, MoreHorizontal, Edit, ZapOff, Trash2, X, ShieldAlert } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useAuth } from '../providers/auth-provider';
import { useMikrotik } from '../providers/mikrotik-provider';
import { formatUptime, formatCompactUptime } from '@/utils/format';
import SummaryCard from '../dashboard/summary-card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { apiFetch } from '@/utils/api';
import ConfirmModal from '@/components/ui/confirm-modal';
import EditPppoeSecretModal from '../management/edit-pppoe-secret-modal';
import AddPppoeSecretModal from '../management/add-pppoe-secret-modal';
import { Plus } from 'lucide-react';
import NocWorkspaceSelectorModal from './NocWorkspaceSelectorModal';

interface PppoeSecret {
    '.id': string;
    name: string;
    profile: string;
    'remote-address'?: string;
    disabled: 'true' | 'false';
    isActive?: boolean;
    uptime?: string;
    activeConnectionId?: string;
    workspace_name: string;
    workspace_id: number;
    deviceId: number;
    router_name?: string;
    mikrotik_status?: 'connected' | 'disconnected' | 'connecting';
}

interface NocManagementTabProps {
    workspaces: { id: number, name: string }[];
}

// Parse MikroTik uptime string (e.g. "1w2d3h4m5s") ke total seconds
function parseMikrotikUptimeToSeconds(uptimeStr: string): number {
    const w = uptimeStr.match(/(\d+)w/);
    const d = uptimeStr.match(/(\d+)d/);
    const h = uptimeStr.match(/(\d+)h/);
    const m = uptimeStr.match(/(\d+)m/);
    const s = uptimeStr.match(/(\d+)s/);
    return (
        (w ? parseInt(w[1]) * 7 * 24 * 3600 : 0) +
        (d ? parseInt(d[1]) * 24 * 3600 : 0) +
        (h ? parseInt(h[1]) * 3600 : 0) +
        (m ? parseInt(m[1]) * 60 : 0) +
        (s ? parseInt(s[1]) : 0)
    );
}

// Convert total seconds kembali ke format MikroTik string
function secondsToMikrotikStr(totalSecs: number): string {
    const w = Math.floor(totalSecs / (7 * 24 * 3600));
    totalSecs %= 7 * 24 * 3600;
    const d = Math.floor(totalSecs / (24 * 3600));
    totalSecs %= 24 * 3600;
    const h = Math.floor(totalSecs / 3600);
    totalSecs %= 3600;
    const m = Math.floor(totalSecs / 60);
    const s = totalSecs % 60;
    let str = '';
    if (w) str += `${w}w`;
    if (d) str += `${d}d`;
    if (h) str += `${h}h`;
    if (m) str += `${m}m`;
    str += `${s}s`;
    return str;
}

const UptimeDisplay = ({ baseUptime, isActive }: { baseUptime: string | undefined, isActive: boolean | undefined }) => {
    // Simpan base seconds dan waktu mount untuk menghitung elapsed
    const mountTimeRef = React.useRef<number>(Date.now());
    const baseSecondsRef = React.useRef<number>(0);
    const [elapsedDisplay, setElapsedDisplay] = useState<string>('');

    useEffect(() => {
        if (!isActive || !baseUptime || baseUptime === '-' || baseUptime === 'N/A') return;
        // Reset ketika baseUptime berubah (data baru dari WS)
        mountTimeRef.current = Date.now();
        baseSecondsRef.current = parseMikrotikUptimeToSeconds(baseUptime);
        // Set initial display
        setElapsedDisplay(secondsToMikrotikStr(baseSecondsRef.current));
        // Tick setiap detik
        const timer = setInterval(() => {
            const elapsed = Math.floor((Date.now() - mountTimeRef.current) / 1000);
            setElapsedDisplay(secondsToMikrotikStr(baseSecondsRef.current + elapsed));
        }, 1000);
        return () => clearInterval(timer);
    }, [isActive, baseUptime]);

    if (!isActive || !baseUptime || baseUptime === '-' || baseUptime === 'N/A') return <span>-</span>;

    const displayStr = elapsedDisplay || baseUptime;
    return (
        <span className="flex flex-col sm:block">
            <span className="sm:hidden">{formatCompactUptime(displayStr)}</span>
            <span className="hidden sm:inline">{formatUptime(displayStr)}</span>
        </span>
    );
};
UptimeDisplay.displayName = 'UptimeDisplay';

const NocManagementTab: React.FC<NocManagementTabProps> = ({ workspaces }) => {
    const workspaceIds = useMemo(() => workspaces.map(w => w.id), [workspaces]);
    const workspaceIdsKey = useMemo(() => [...workspaceIds].sort().join(','), [workspaceIds]);
    const { token } = useAuth();
    const { allPppoeSecrets, allDevicesStatus } = useMikrotik();
    const [apiSecrets, setApiSecrets] = useState<PppoeSecret[]>([]);
    const [loading, setLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [sortColumn, setSortColumn] = useState<string | null>(null);
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
    const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive' | 'isolate'>('all');
    const searchInputRef = React.useRef<HTMLInputElement>(null);
    const tableContainerRef = React.useRef<HTMLDivElement>(null);

    const [isActionLoading, setIsActionLoading] = useState(false);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [secretToEdit, setSecretToEdit] = useState<PppoeSecret | null>(null);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [secretToDelete, setSecretToDelete] = useState<PppoeSecret | null>(null);
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [selectedWorkspaceForAdd, setSelectedWorkspaceForAdd] = useState<number | null>(null);
    const [isNocWorkspaceSelectorOpen, setIsNocWorkspaceSelectorOpen] = useState(false);

    const [isInitialLoad, setIsInitialLoad] = useState(true);
    const memoizedSecretToEdit = useMemo(() => {
        if (!secretToEdit) return null;
        return { ...secretToEdit, disabled: secretToEdit.disabled === 'true' };
    }, [secretToEdit]);

    // Reset scroll ke atas saat search atau filter berubah
    useEffect(() => {
        if (tableContainerRef.current) {
            tableContainerRef.current.scrollTop = 0;
        }
    }, [searchQuery, activeFilter]);

    // Merge API cache + live WS data → update state (ikuti pola Management table)
    const [mergedSecrets, setMergedSecrets] = useState<PppoeSecret[]>([]);

    useEffect(() => {
        const mergedMap = new Map<string, PppoeSecret>();

        // 1. Start with API data (stale cache)
        apiSecrets.forEach(s => {
            const deviceConnected = allDevicesStatus[s.deviceId];
            const mikrotik_status = deviceConnected === undefined ? 'connected' : (deviceConnected.isConnected ? 'connected' : 'disconnected');
            mergedMap.set(`${s.deviceId}-${s.name}`, { ...s, mikrotik_status });
        });

        // 2. Pre-compute workspace Map
        const workspacesMap = new Map(workspaces.map(w => [w.id, w.name]));

        // 3. Overlay dengan Live WS data
        allPppoeSecrets.forEach(s => {
            const existing = mergedMap.get(`${s.deviceId}-${s.name}`);
            const resolvedWsName = s.workspace_name || existing?.workspace_name || workspacesMap.get(s.workspace_id) || 'Loading...';
            const resolvedRouterName = s.router_name || existing?.router_name || 'Loading...';
            mergedMap.set(`${s.deviceId}-${s.name}`, {
                ...existing,
                ...s,
                mikrotik_status: 'connected',
                workspace_name: resolvedWsName,
                router_name: resolvedRouterName,
                workspace_id: s.workspace_id,
            } as PppoeSecret);
        });

        const all = Array.from(mergedMap.values());
        // Filter hanya workspace yang dipilih
        const filtered = all.filter(s => workspaceIds.includes(s.workspace_id));
        setMergedSecrets(filtered);
    }, [apiSecrets, allPppoeSecrets, allDevicesStatus, workspaceIds, workspaces]);


    const fetchSecrets = useCallback(async () => {
        if (workspaceIds.length === 0) {
            setApiSecrets([]);
            setLoading(false);
            setIsInitialLoad(false);
            return;
        }

        // Hanya tampilkan spinner loading pada fetch pertama
        setLoading(true);
        try {
            const response = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/api/noc/secrets`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ workspaceIds })
            });

            if (response.ok) {
                const data = await response.json();
                const mappedSecrets = (data.secrets || []).map((s: any) => ({
                    ...s,
                    deviceId: s.device_id || s.deviceId
                }));
                setApiSecrets(mappedSecrets);
            }
        } catch (error) {
            console.error("Failed to fetch NOC secrets", error);
        } finally {
            setLoading(false);
            setIsInitialLoad(false);
        }
    }, [workspaceIdsKey, token]);

    useEffect(() => {
        fetchSecrets();
    }, [fetchSecrets]);

    const handleSort = (column: string) => {
        if (sortColumn === column) {
            setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
        } else {
            setSortColumn(column);
            setSortDirection('asc');
        }
    };

    const filteredSecrets = useMemo(() => {
        // Filter out secrets from offline routers to prevent confusion
        let filtered = mergedSecrets.filter(s => s.mikrotik_status === 'connected');

        if (activeFilter === 'active') {
            filtered = filtered.filter(secret => secret.isActive && secret.disabled === 'false');
        } else if (activeFilter === 'inactive') {
            filtered = filtered.filter(secret => !secret.isActive);
        } else if (activeFilter === 'isolate') {
            filtered = filtered.filter(secret => secret.profile.toLowerCase() === 'isolir');
        }

        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase().trim();
            filtered = filtered.filter(secret => {
                return (
                    secret.name.toLowerCase().includes(query) ||
                    secret.profile.toLowerCase().includes(query) ||
                    (secret['remote-address'] || '').toLowerCase().includes(query) ||
                    secret.workspace_name.toLowerCase().includes(query) ||
                    (secret.router_name || '').toLowerCase().includes(query)
                );
            });
        }

        if (sortColumn) {
            filtered = [...filtered].sort((a, b) => {
                let aValue: any;
                let bValue: any;

                switch (sortColumn) {
                    case 'status':
                        aValue = a.disabled === 'true' ? 0 : (a.isActive ? 1 : 2);
                        bValue = b.disabled === 'true' ? 0 : (b.isActive ? 1 : 2);
                        break;
                    case 'name':
                        aValue = a.name.toLowerCase();
                        bValue = b.name.toLowerCase();
                        break;
                    case 'workspace':
                        aValue = (a.router_name || a.workspace_name).toLowerCase();
                        bValue = (b.router_name || b.workspace_name).toLowerCase();
                        break;
                    case 'profile':
                        aValue = a.profile.toLowerCase();
                        bValue = b.profile.toLowerCase();
                        break;
                    case 'remote-address':
                        aValue = (a['remote-address'] || '').toLowerCase();
                        bValue = (b['remote-address'] || '').toLowerCase();
                        break;
                    default:
                        return 0;
                }

                if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
                if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
                return 0;
            });
        }

        return filtered;
    }, [mergedSecrets, activeFilter, searchQuery, sortColumn, sortDirection]);

    const summary = useMemo(() => {
        const onlineSecrets = mergedSecrets.filter(s => s.mikrotik_status === 'connected');
        const total = onlineSecrets.length;
        const active = onlineSecrets.filter(s => s.isActive && s.disabled === 'false').length;
        const isolate = onlineSecrets.filter(s => s.profile.toLowerCase() === 'isolir').length;
        return {
            total,
            active,
            inactive: Math.max(0, total - active),
            isolate
        };
    }, [mergedSecrets]);

    const offlineRouters = useMemo(() => {
        const uniqueRouters = new Map();
        mergedSecrets.forEach(s => {
            if (!uniqueRouters.has(s.router_name || s.workspace_name)) {
                uniqueRouters.set(s.router_name || s.workspace_name, s.mikrotik_status);
            }
        });
        return Array.from(uniqueRouters.entries())
            .filter(([_, status]) => status !== 'connected')
            .map(([name]) => name);
    }, [mergedSecrets]);

    const handleAction = useCallback(async (action: 'enable' | 'disable' | 'kick' | 'isolate' | 'unisolate', secret: PppoeSecret) => {
        setIsActionLoading(true);
        const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
        const toastId = toast.loading(`Memproses ${action} untuk ${secret.name}...`);

        try {
            if (action === 'isolate' || action === 'unisolate') {
                const encodedId = encodeURIComponent(secret.name);
                const res = await apiFetch(`${apiUrl}/api/pppoe/secrets/${encodedId}/${action}?workspaceId=${secret.workspace_id}&deviceId=${secret.deviceId}`, {
                    method: 'POST'
                });
                
                if (!res.ok) {
                    const errData = await res.json();
                    throw new Error(errData.message || `Gagal melakukan ${action}`);
                }
                
                toast.success(action === 'isolate' ? "User Berhasil Di-Isolir" : "Isolir Berhasil Dibuka", {
                    description: action === 'isolate' ? `User ${secret.name} telah dipindahkan ke profil Isolir.` : `Profil user ${secret.name} telah dikembalikan.`
                });
            } else if (action === 'kick') {
                if (!secret.isActive) {
                    throw new Error("User tidak aktif, tidak bisa di-kick.");
                }
                if (!secret.activeConnectionId) {
                    throw new Error("ID koneksi aktif tidak ditemukan. Silakan refresh halaman.");
                }

                try {
                    const encodedId = encodeURIComponent(secret.activeConnectionId);
                    const res = await apiFetch(`${apiUrl}/api/pppoe/active/${encodedId}/kick?workspaceId=${secret.workspace_id}&deviceId=${secret.deviceId}`, {
                        method: 'POST'
                    });
                    if (!res.ok) {
                        const errData = await res.json();
                        throw new Error(errData.message || "Aksi gagal");
                    }
                } catch (error: any) {
                    throw new Error(error.message || "Gagal melakukan kick");
                }
            } else if (action === 'disable') {
                const encodedId = encodeURIComponent(secret.name);
                const res = await apiFetch(`${apiUrl}/api/pppoe/secrets/${encodedId}/status?workspaceId=${secret.workspace_id}&deviceId=${secret.deviceId}`, {
                    method: 'PUT',
                    body: JSON.stringify({ disabled: 'yes' })
                });
                if (!res.ok) {
                    const errData = await res.json();
                    throw new Error(errData.message || "Aksi gagal");
                }

                if (secret.isActive && secret.activeConnectionId) {
                    try {
                        const encodedActiveId = encodeURIComponent(secret.activeConnectionId);
                        await apiFetch(`${apiUrl}/api/pppoe/active/${encodedActiveId}/kick?workspaceId=${secret.workspace_id}&deviceId=${secret.deviceId}`, {
                            method: 'POST'
                        });
                    } catch (kickError: any) {
                        console.warn('Error saat kick user setelah disable:', kickError.message);
                    }
                }
            } else {
                // Enable
                const encodedId = encodeURIComponent(secret.name);
                const res = await apiFetch(`${apiUrl}/api/pppoe/secrets/${encodedId}/status?workspaceId=${secret.workspace_id}&deviceId=${secret.deviceId}`, {
                    method: 'PUT',
                    body: JSON.stringify({ disabled: 'no' })
                });
                if (!res.ok) {
                    const errData = await res.json();
                    throw new Error(errData.message || "Aksi gagal");
                }
            }

            toast.success("Aksi Berhasil", { id: toastId, description: `Perintah ${action} selesai dieksekusi.` });
            fetchSecrets();
        } catch (error: any) {
            toast.error(`Gagal Melakukan Aksi`, { id: toastId, description: error.message });
        } finally {
            setIsActionLoading(false);
        }
    }, [fetchSecrets]);

    const handleEditClick = useCallback((user: PppoeSecret) => {
        setSecretToEdit(user);
        setIsEditModalOpen(true);
    }, []);

    const handleDeleteClick = useCallback((user: PppoeSecret) => {
        setSecretToDelete(user);
        setIsDeleteModalOpen(true);
    }, []);

    const handleDeleteConfirm = useCallback(async () => {
        if (!secretToDelete) return;
        setIsActionLoading(true);
        const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;

        const toastId = toast.loading(`Menghapus secret ${secretToDelete.name}...`);
        try {
            const encodedId = encodeURIComponent(secretToDelete.name);
            const res = await apiFetch(`${apiUrl}/api/pppoe/secrets/${encodedId}?workspaceId=${secretToDelete.workspace_id}&deviceId=${secretToDelete.deviceId}`, { method: 'DELETE' });
            if (!res.ok) throw new Error("Gagal Menghapus Secret");

            // Update local state instan agar hilang dari UI tanpa nunggu fetch/WS
            setApiSecrets(prev => prev.filter(s => !(s.name === secretToDelete.name && s.deviceId === secretToDelete.deviceId)));
            
            toast.success("Berhasil Menghapus Secret", { id: toastId, description: `Secret untuk ${secretToDelete.name} telah dihapus.` });
            fetchSecrets();
        } catch (error: any) {
            toast.error("Gagal Menghapus Secret", { id: toastId, description: error.message || "Terjadi kesalahan saat menghapus data." });
        } finally {
            setIsActionLoading(false);
            setIsDeleteModalOpen(false);
            setSecretToDelete(null);
        }
    }, [secretToDelete, fetchSecrets]);

    const renderSummaryCard = (title: string, count: number, icon: React.ReactNode, color: string, filter: 'all' | 'active' | 'inactive' | 'isolate') => (
        <button onClick={() => setActiveFilter(filter)} className={`w-full text-left rounded-lg transition-all ${activeFilter === filter ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''}`}>
            <SummaryCard title={title} count={loading && mergedSecrets.length === 0 ? <Loader2 className="animate-spin" /> : count} icon={icon} colorClass={color} />
        </button>
    );

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-4">
                {renderSummaryCard("Total", summary.total, <Users />, "bg-gradient-to-br from-blue-500 to-blue-700", 'all')}
                {renderSummaryCard("Aktif", summary.active, <UserCheck />, "bg-gradient-to-br from-green-500 to-green-700", 'active')}
                {renderSummaryCard("Tidak Aktif", summary.inactive, <UserX />, "bg-gradient-to-br from-red-500 to-red-700", 'inactive')}
                {renderSummaryCard("Isolir", summary.isolate, <ShieldAlert />, "bg-gradient-to-br from-orange-500 to-orange-700", 'isolate')}
            </div>

            {offlineRouters.length > 0 && (
                <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 flex items-center gap-3 text-destructive animate-in fade-in slide-in-from-top-4">
                    <ZapOff size={18} className="shrink-0" />
                    <div className="text-sm">
                        <span className="font-bold">Beberapa router sedang offline: </span>
                        {offlineRouters.join(', ')}. 
                        Data dari router ini disembunyikan untuk akurasi.
                    </div>
                </div>
            )}

            <Card>
                <CardHeader>
                    <div className="flex flex-col lg:flex-row lg:justify-between lg:items-center gap-4">
                        <CardTitle className="text-lg sm:text-xl">Secret PPPoE ({isInitialLoad ? '...' : filteredSecrets.length})</CardTitle>
                        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center flex-1 lg:justify-end">
                            <div className="flex gap-2 items-center">
                                <Button 
                                    size="sm" 
                                    className="h-9 px-3"
                                    onClick={() => setIsNocWorkspaceSelectorOpen(true)}
                                >
                                    <Plus size={16} className="mr-1" /> <span className="hidden sm:inline">Tambah Secret</span>
                                </Button>
                            </div>
                            <div className="relative w-full lg:max-w-xs">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                    ref={searchInputRef}
                                    type="text"
                                    placeholder="Cari user, IP, atau workspace..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="pl-9 pr-8 bg-input h-9 text-sm"
                                />
                                {searchQuery && (
                                    <button
                                        onClick={() => setSearchQuery('')}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                                        aria-label="Hapus pencarian"
                                    >
                                        <X size={14} />
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    <div ref={tableContainerRef} className="h-[60vh] overflow-y-auto overflow-x-auto overscroll-contain">
                        <table className="w-full text-xs sm:text-sm">
                            <thead className="text-left bg-secondary sticky top-0 z-10">
                                <tr>
                                    <th className="p-2 sm:p-4 font-semibold cursor-pointer select-none w-[80px] sm:w-[100px]" onClick={() => handleSort('status')}>Status</th>
                                    <th className="p-2 sm:p-4 font-semibold cursor-pointer select-none" onClick={() => handleSort('name')}>User / Identitas</th>
                                    <th className="p-2 sm:p-4 font-semibold cursor-pointer select-none hidden md:table-cell" onClick={() => handleSort('workspace')}>Router</th>
                                    <th className="p-2 sm:p-4 font-semibold cursor-pointer select-none hidden sm:table-cell" onClick={() => handleSort('profile')}>Profil</th>
                                    <th className="p-2 sm:p-4 font-semibold cursor-pointer select-none hidden lg:table-cell" onClick={() => handleSort('remote-address')}>Remote IP</th>
                                    <th className="p-2 sm:p-4 font-semibold cursor-pointer select-none w-[80px] sm:w-[120px]">Uptime</th>
                                    <th className="p-2 sm:p-4 font-semibold text-center w-[50px] sm:w-[80px]">Aksi</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading && mergedSecrets.length === 0 ? (
                                    <tr><td colSpan={7} className="text-center p-10"><Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" /></td></tr>
                                ) : filteredSecrets.length > 0 ? (
                                    filteredSecrets.map((user) => {
                                        const uniqueKey = user['.id'] || user.name;
                                        return (
                                            <tr 
                                                key={`${user.workspace_id}-${uniqueKey}`}
                                                className="border-b hover:bg-muted/30 transition-colors"
                                            >
                                                <td className="p-2 sm:p-4">
                                                    {user.disabled === 'true' ?
                                                        (<span className="flex items-center gap-1 text-muted-foreground"><PowerOff size={14} /> <span className="hidden sm:inline">Disabled</span></span>) :
                                                        user.isActive ?
                                                            (<span className="flex items-center gap-1 text-green-500"><Power size={14} className="animate-pulse" /> <span className="hidden sm:inline">Active</span></span>) :
                                                            (<span className="flex items-center gap-1 text-red-500"><PowerOff size={14} /> <span className="hidden sm:inline">Inactive</span></span>)
                                                    }
                                                </td>
                                                <td className="p-2 sm:p-4">
                                                    <div className="flex flex-col gap-0.5">
                                                        <span className="font-bold sm:font-medium truncate max-w-[120px] sm:max-w-[200px]" title={user.name}>{user.name}</span>
                                                        <div className="flex flex-col sm:hidden gap-0.5">
                                                            <span className="text-[10px] text-muted-foreground truncate max-w-[120px]" title={`Profile: ${user.profile}`}>
                                                                {user.profile}
                                                            </span>
                                                            <span className="text-[10px] text-primary/80 font-mono truncate max-w-[120px]">
                                                                {user['remote-address'] || 'No IP'}
                                                            </span>
                                                            <span className="text-[10px] text-muted-foreground md:hidden truncate max-w-[120px]" title="Router">
                                                                {user.router_name || user.workspace_name}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="p-2 sm:p-4 hidden md:table-cell">
                                                    <span className="inline-flex items-center px-2 py-1 rounded-full text-[10px] font-medium bg-primary/10 text-primary truncate max-w-[120px] lg:max-w-[180px]" title={user.router_name || user.workspace_name}>
                                                        {user.router_name || user.workspace_name}
                                                    </span>
                                                </td>
                                                <td className="p-2 sm:p-4 hidden sm:table-cell">
                                                    <span className="truncate max-w-[100px] lg:max-w-[150px] block" title={user.profile}>{user.profile}</span>
                                                </td>
                                                <td className="p-2 sm:p-4 hidden lg:table-cell">
                                                    <span className="text-[10px] text-primary/80 font-mono truncate max-w-[120px]">
                                                        {user['remote-address'] || '-'}
                                                    </span>
                                                </td>
                                                <td className="p-2 sm:p-4 font-mono text-[10px] sm:text-xs whitespace-nowrap">
                                                    <UptimeDisplay baseUptime={user.uptime} isActive={user.isActive} />
                                                </td>
                                                <td className="p-2 sm:p-4 text-center">
                                                    <DropdownMenu>
                                                        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreHorizontal size={16} /></Button></DropdownMenuTrigger>
                                                        <DropdownMenuContent align="end">
                                                            <DropdownMenuItem onClick={() => handleEditClick(user)}>
                                                                <Edit className="mr-2 h-4 w-4" /> Edit
                                                            </DropdownMenuItem>
                                                            <DropdownMenuSeparator />
                                                            {user.profile === 'Isolir' ? (
                                                                <DropdownMenuItem onClick={() => handleAction('unisolate', user)}>
                                                                    <ZapOff className="mr-2 h-4 w-4 text-green-500" /> Buka Isolir
                                                                </DropdownMenuItem>
                                                            ) : (
                                                                <DropdownMenuItem onClick={() => handleAction('isolate', user)}>
                                                                    <ZapOff className="mr-2 h-4 w-4 text-orange-500" /> Isolir User
                                                                </DropdownMenuItem>
                                                            )}
                                                            <DropdownMenuSeparator />
                                                            {user.isActive &&
                                                                <DropdownMenuItem onClick={() => handleAction('kick', user)}>
                                                                    <ZapOff className="mr-2 h-4 w-4" /> Kick User
                                                                </DropdownMenuItem>
                                                            }
                                                            {user.disabled === 'true' ?
                                                                (<DropdownMenuItem onClick={() => handleAction('enable', user)}> <Power className="mr-2 h-4 w-4" /> Enable </DropdownMenuItem>) :
                                                                (<DropdownMenuItem onClick={() => handleAction('disable', user)}> <PowerOff className="mr-2 h-4 w-4" /> Disable </DropdownMenuItem>)
                                                            }
                                                            <DropdownMenuSeparator />
                                                            <DropdownMenuItem className="text-destructive focus:bg-destructive/10 focus:text-destructive" onClick={() => handleDeleteClick(user)}>
                                                                <Trash2 className="mr-2 h-4 w-4" /> Hapus
                                                            </DropdownMenuItem>
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                </td>
                                            </tr>
                                        );
                                    })
                                ) : (
                                    <tr><td colSpan={7} className="text-center p-10 text-muted-foreground">Tidak ada secret yang cocok.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>

            {/* Modals */}
            <ConfirmModal
                isOpen={isDeleteModalOpen}
                onClose={() => setIsDeleteModalOpen(false)}
                onConfirm={handleDeleteConfirm}
                title="Hapus Secret PPPoE"
                description={`Apakah Anda yakin ingin menghapus secret "${secretToDelete?.name}" dari workspace ${secretToDelete?.workspace_name}? Tindakan ini tidak dapat dibatalkan.`}
                confirmText="Hapus"
                isLoading={isActionLoading}
            />

            {isEditModalOpen && secretToEdit && (
                <EditPppoeSecretModal
                    isOpen={isEditModalOpen}
                    onClose={() => setIsEditModalOpen(false)}
                    secretToEdit={memoizedSecretToEdit}
                    onSuccess={fetchSecrets}
                    nocWorkspaceId={secretToEdit.workspace_id}
                />
            )}
            <AddPppoeSecretModal 
                isOpen={isAddModalOpen}
                onClose={() => setIsAddModalOpen(false)}
                onSuccess={fetchSecrets}
                nocWorkspaceId={selectedWorkspaceForAdd || undefined}
            />
            <NocWorkspaceSelectorModal
                isOpen={isNocWorkspaceSelectorOpen}
                onClose={() => setIsNocWorkspaceSelectorOpen(false)}
                workspaces={workspaces}
                onSelect={(id) => {
                    setSelectedWorkspaceForAdd(id);
                    setIsAddModalOpen(true);
                }}
            />
        </div>
    );
};

export default NocManagementTab;
