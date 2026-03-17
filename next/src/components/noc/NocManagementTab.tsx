'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion } from '@/components/motion';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Power, PowerOff, Loader2, Search, ArrowUpDown, ChevronUp, ChevronDown, Users, UserCheck, UserX, MoreHorizontal, Edit, ZapOff, Trash2, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useAuth } from '../providers/auth-provider';
import { formatUptime, formatCompactUptime } from '@/utils/format';
import SummaryCard from '../dashboard/summary-card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { apiFetch } from '@/utils/api';
import ConfirmModal from '@/components/ui/confirm-modal';
import EditPppoeSecretModal from '../management/edit-pppoe-secret-modal';

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
    router_name?: string;
    mikrotik_status?: 'connected' | 'disconnected' | 'connecting';
}

interface NocManagementTabProps {
    workspaceIds: number[];
}

const NocManagementTab: React.FC<NocManagementTabProps> = ({ workspaceIds }) => {
    const { token } = useAuth();
    const [secrets, setSecrets] = useState<PppoeSecret[]>([]);
    const [loading, setLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [sortColumn, setSortColumn] = useState<string | null>(null);
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
    const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('all');
    const searchInputRef = React.useRef<HTMLInputElement>(null);

    const [isActionLoading, setIsActionLoading] = useState(false);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [secretToEdit, setSecretToEdit] = useState<PppoeSecret | null>(null);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [secretToDelete, setSecretToDelete] = useState<PppoeSecret | null>(null);

    const [lastFetchTime, setLastFetchTime] = useState<number>(0);
    const [isInitialLoad, setIsInitialLoad] = useState(true);
    const [uptimeOffset, setUptimeOffset] = useState(0);

    useEffect(() => {
        const interval = setInterval(() => setUptimeOffset(prev => prev + 1), 1000);
        return () => clearInterval(interval);
    }, []);

    const secretsUptimeMap = useMemo(() => {
        const map = new Map<string, string>();
        secrets.forEach(s => { if (s.name && s.isActive && s.uptime) map.set(s.name, s.uptime); });
        return map;
    }, [secrets]);

    const parseUptimeToSeconds = (uptime: string): number => {
        const w = uptime.match(/(\d+)w/); const d = uptime.match(/(\d+)d/);
        const h = uptime.match(/(\d+)h/); const m = uptime.match(/(\d+)m/);
        const s = uptime.match(/(\d+)s/);
        return (w ? +w[1] * 604800 : 0) + (d ? +d[1] * 86400 : 0) +
            (h ? +h[1] * 3600 : 0) + (m ? +m[1] * 60 : 0) + (s ? +s[1] : 0);
    };

    const formatSecondsToUptime = (total: number): string => {
        if (total <= 0) return '0s';
        const w = Math.floor(total / 604800); total %= 604800;
        const d = Math.floor(total / 86400); total %= 86400;
        const h = Math.floor(total / 3600); total %= 3600;
        const m = Math.floor(total / 60); const sec = total % 60;
        return (w ? w + 'w' : '') + (d ? d + 'd' : '') + (h ? h + 'h' : '') + (m ? m + 'm' : '') + sec + 's';
    };

    const getUptime = useCallback((name: string): string => {
        const base = secretsUptimeMap.get(name);
        if (!base || base === 'N/A') return base || '-';
        return formatSecondsToUptime(parseUptimeToSeconds(base) + Math.min(uptimeOffset, 5));
    }, [secretsUptimeMap, uptimeOffset]);

    const fetchSecrets = useCallback(async (isBackground = false) => {
        if (workspaceIds.length === 0) {
            setSecrets([]);
            setLoading(false);
            setIsInitialLoad(false);
            return;
        }

        // Hindari fetch terlalu sering (debounce manual)
        const now = Date.now();
        if (now - lastFetchTime < 3000) return;
        setLastFetchTime(now);

        // Hanya tampilkan spinner loading pada fetch pertama, bukan saat refresh background
        if (!isBackground) setLoading(true);
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
                setSecrets(data.secrets || []);
                setUptimeOffset(0); // Re-sync saat data baru dari server
            }
        } catch (error) {
            console.error("Failed to fetch NOC secrets", error);
        } finally {
            setLoading(false);
            setIsInitialLoad(false);
        }
    }, [workspaceIds, token, lastFetchTime]);

    // Polling data every 5 seconds for NOC view (slower than regular websocket but good enough for multi-workspace)
    // Reset lastFetchTime when workspaceIds changes so filter switch always triggers a fresh fetch
    useEffect(() => {
        setLastFetchTime(0);
    }, [workspaceIds.join(',')]);

    useEffect(() => {
        fetchSecrets(false); // first load shows spinner

        const interval = setInterval(() => {
            // Reset last fetch time to allow interval to run
            setLastFetchTime(0);
            fetchSecrets(true); // background refresh — no spinner
        }, 5000);

        return () => clearInterval(interval);
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
        let filtered = secrets.filter(s => s.mikrotik_status === 'connected');

        if (activeFilter === 'active') {
            filtered = filtered.filter(secret => secret.isActive && secret.disabled === 'false');
        } else if (activeFilter === 'inactive') {
            filtered = filtered.filter(secret => !secret.isActive);
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
    }, [secrets, activeFilter, searchQuery, sortColumn, sortDirection]);

    const summary = useMemo(() => {
        const onlineSecrets = secrets.filter(s => s.mikrotik_status === 'connected');
        const total = onlineSecrets.length;
        const active = onlineSecrets.filter(s => s.isActive && s.disabled === 'false').length;
        return {
            total,
            active,
            inactive: Math.max(0, total - active)
        };
    }, [secrets]);

    const offlineRouters = useMemo(() => {
        const uniqueRouters = new Map();
        secrets.forEach(s => {
            if (!uniqueRouters.has(s.router_name || s.workspace_name)) {
                uniqueRouters.set(s.router_name || s.workspace_name, s.mikrotik_status);
            }
        });
        return Array.from(uniqueRouters.entries())
            .filter(([_, status]) => status !== 'connected')
            .map(([name]) => name);
    }, [secrets]);

    const handleAction = async (action: 'enable' | 'disable' | 'kick', secret: PppoeSecret) => {
        setIsActionLoading(true);
        const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;

        try {
            if (action === 'kick') {
                if (!secret.isActive) {
                    throw new Error("User tidak aktif, tidak bisa di-kick.");
                }
                if (!secret.activeConnectionId) {
                    throw new Error("ID koneksi aktif tidak ditemukan. Silakan refresh halaman.");
                }

                try {
                    const encodedId = encodeURIComponent(secret.activeConnectionId);
                    const res = await apiFetch(`${apiUrl}/api/pppoe/active/${encodedId}/kick?workspaceId=${secret.workspace_id}`, {
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
                const res = await apiFetch(`${apiUrl}/api/pppoe/secrets/${encodedId}/status?workspaceId=${secret.workspace_id}`, {
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
                        await apiFetch(`${apiUrl}/api/pppoe/active/${encodedActiveId}/kick?workspaceId=${secret.workspace_id}`, {
                            method: 'POST'
                        });
                    } catch (kickError: any) {
                        console.warn('Error saat kick user setelah disable:', kickError.message);
                    }
                }
            } else {
                // Enable
                const encodedId = encodeURIComponent(secret.name);
                const res = await apiFetch(`${apiUrl}/api/pppoe/secrets/${encodedId}/status?workspaceId=${secret.workspace_id}`, {
                    method: 'PUT',
                    body: JSON.stringify({ disabled: 'no' })
                });
                if (!res.ok) {
                    const errData = await res.json();
                    throw new Error(errData.message || "Aksi gagal");
                }
            }

            toast.success("Aksi Berhasil", { description: `Perintah ${action} selesai dieksekusi.` });
            setLastFetchTime(0);
            fetchSecrets();
        } catch (error: any) {
            toast.error(`Gagal Melakukan Aksi`, { description: error.message });
        } finally {
            setIsActionLoading(false);
        }
    };

    const handleDeleteConfirm = async () => {
        if (!secretToDelete) return;
        setIsActionLoading(true);
        const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;

        try {
            const encodedId = encodeURIComponent(secretToDelete.name);
            const res = await apiFetch(`${apiUrl}/api/pppoe/secrets/${encodedId}?workspaceId=${secretToDelete.workspace_id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error("Gagal Menghapus Secret");

            toast.success("Berhasil Menghapus Secret", { description: `Secret untuk ${secretToDelete.name} telah dihapus.` });
            setLastFetchTime(0);
            fetchSecrets();
        } catch (error: any) {
            toast.error("Gagal Menghapus Secret", { description: error.message || "Terjadi kesalahan saat menghapus data." });
        } finally {
            setIsActionLoading(false);
            setIsDeleteModalOpen(false);
            setSecretToDelete(null);
        }
    };

    const renderSummaryCard = (title: string, count: number, icon: React.ReactNode, color: string, filter: 'all' | 'active' | 'inactive') => (
        <button onClick={() => setActiveFilter(filter)} className={`w-full text-left rounded-lg transition-all ${activeFilter === filter ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''}`}>
            <SummaryCard title={title} count={loading && secrets.length === 0 ? <Loader2 className="animate-spin" /> : count} icon={icon} colorClass={color} />
        </button>
    );

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-3 gap-2 sm:gap-4">
                {renderSummaryCard("Total", summary.total, <Users />, "bg-gradient-to-br from-blue-500 to-blue-700", 'all')}
                {renderSummaryCard("Aktif", summary.active, <UserCheck />, "bg-gradient-to-br from-green-500 to-green-700", 'active')}
                {renderSummaryCard("Tidak Aktif", summary.inactive, <UserX />, "bg-gradient-to-br from-red-500 to-red-700", 'inactive')}
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
                        <div className="relative w-full lg:max-w-md">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                ref={searchInputRef}
                                type="text"
                                placeholder="Cari user, IP, atau workspace..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-9 pr-8 bg-input h-9"
                            />
                            {searchQuery && (
                                <button
                                    type="button"
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => {
                                        setSearchQuery('');
                                        searchInputRef.current?.focus();
                                    }}
                                >
                                    <X size={14} />
                                </button>
                            )}
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="h-[60vh] overflow-y-auto overflow-x-auto overscroll-contain">
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
                                {loading && secrets.length === 0 ? (
                                    <tr><td colSpan={6} className="text-center p-10"><Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" /></td></tr>
                                ) : filteredSecrets.length > 0 ? (
                                    filteredSecrets.map((user, i) => (
                                        <tr key={`${user.workspace_id}-${user['.id'] || user.name}-${i}`} className="border-b hover:bg-muted/30 transition-colors">
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
                                                {user.isActive ? (
                                                    <span className="flex flex-col sm:block">
                                                        <span className="sm:hidden">{formatCompactUptime(getUptime(user.name))}</span>
                                                        <span className="hidden sm:inline">{formatUptime(getUptime(user.name))}</span>
                                                    </span>
                                                ) : '-'}
                                            </td>
                                            <td className="p-2 sm:p-4 text-center">
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreHorizontal size={16} /></Button></DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end">
                                                        <DropdownMenuItem onClick={() => { setSecretToEdit(user); setIsEditModalOpen(true); }}>
                                                            <Edit className="mr-2 h-4 w-4" /> Edit
                                                        </DropdownMenuItem>
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
                                                        <DropdownMenuItem className="text-destructive focus:bg-destructive/10 focus:text-destructive" onClick={() => { setSecretToDelete(user); setIsDeleteModalOpen(true); }}>
                                                            <Trash2 className="mr-2 h-4 w-4" /> Hapus
                                                        </DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr><td colSpan={6} className="text-center p-10 text-muted-foreground">Tidak ada secret yang cocok.</td></tr>
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
                    secretToEdit={{ ...secretToEdit, disabled: secretToEdit.disabled === 'true' }}
                    onSuccess={() => {
                        setLastFetchTime(0);
                        fetchSecrets();
                    }}
                    // Note: override via querystring in the edit modal handles its own patch logic using active mikrotik selected id normally
                    // Given we added workspaceId override natively in edit mode this requires passing workspaceId as prop. 
                    // To do this simply, we will construct apiFetch locally inside the EditModal? No, just pass prop:
                    nocWorkspaceId={secretToEdit.workspace_id}
                />
            )}
        </div>
    );
};

export default NocManagementTab;
