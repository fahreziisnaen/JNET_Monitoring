'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Power, PowerOff, Loader2, Search, Users, UserCheck, UserX, MoreHorizontal, Edit, ZapOff, Trash2, X, ShieldAlert } from 'lucide-react';
import { Input } from '@/components/ui/input';
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
import { Plus, ChevronLeft, ChevronRight } from 'lucide-react';

const ITEMS_PER_PAGE = 100;
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
}

interface NocManagementTabProps {
    workspaces: { id: number, name: string }[];
}

// ─── Live Uptime Counter ─────────────────────────────────────────────────────

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
    const mountTimeRef = React.useRef<number>(Date.now());
    const baseSecondsRef = React.useRef<number>(0);
    const [elapsedDisplay, setElapsedDisplay] = useState<string>('');

    useEffect(() => {
        if (!isActive || !baseUptime || baseUptime === '-' || baseUptime === 'N/A') return;
        mountTimeRef.current = Date.now();
        baseSecondsRef.current = parseMikrotikUptimeToSeconds(baseUptime);
        setElapsedDisplay(secondsToMikrotikStr(baseSecondsRef.current));
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

// ─── Main Component ───────────────────────────────────────────────────────────

const NocManagementTab: React.FC<NocManagementTabProps> = ({ workspaces }) => {
    const workspaceIds = useMemo(() => workspaces.map(w => w.id), [workspaces]);
    const { allPppoeSecrets } = useMikrotik();

    // ── State UI ───────────────────────────────────────────────────────────────
    const [searchQuery, setSearchQuery] = useState('');
    const [sortColumn, setSortColumn] = useState<string | null>(null);
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
    const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive' | 'isolate'>('all');
    const tableContainerRef = React.useRef<HTMLDivElement>(null);

    const [isActionLoading, setIsActionLoading] = useState(false);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [secretToEdit, setSecretToEdit] = useState<PppoeSecret | null>(null);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [secretToDelete, setSecretToDelete] = useState<PppoeSecret | null>(null);
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [selectedWorkspaceForAdd, setSelectedWorkspaceForAdd] = useState<number | null>(null);
    const [isNocWorkspaceSelectorOpen, setIsNocWorkspaceSelectorOpen] = useState(false);
    const [recentlyDeleted, setRecentlyDeleted] = useState<Set<string>>(new Set());
    const [currentPage, setCurrentPage] = useState(1);

    const memoizedSecretToEdit = useMemo(() => {
        if (!secretToEdit) return null;
        return { ...secretToEdit, disabled: secretToEdit.disabled === 'true' };
    }, [secretToEdit]);

    // Reset scroll dan halaman saat filter/search berubah
    useEffect(() => {
        setCurrentPage(1);
        if (tableContainerRef.current) {
            tableContainerRef.current.scrollTop = 0;
        }
    }, [searchQuery, activeFilter, sortColumn, sortDirection]);

    // ── Data langsung dari WebSocket tanpa intermediate state ─────────────────
    // useMemo murni: tidak ada useEffect, tidak ada setState, tidak ada race condition
    const allSecrets = useMemo<PppoeSecret[]>(() => {
        if (workspaceIds.length === 0) return [];
        const arr = (Array.isArray(allPppoeSecrets) ? allPppoeSecrets : []) as any[];
        return arr
            .filter(s =>
                workspaceIds.includes(s.workspace_id) &&
                !recentlyDeleted.has(`${s.deviceId}-${s.name}`)
            )
            .map(secret => ({
                '.id': secret['.id'] || '',
                name: secret.name || '',
                profile: secret.profile || '',
                'remote-address': secret.currentAddress || secret['remote-address'] || undefined,
                disabled: (secret.disabled || 'false') as 'true' | 'false',
                isActive: secret.isActive === true,
                activeConnectionId: secret.activeConnectionId || undefined,
                deviceId: secret.deviceId,
                workspace_id: secret.workspace_id,
                workspace_name: secret.workspace_name || '',
                router_name: secret.router_name || '',
                uptime: secret.uptime || 'N/A',
            } as PppoeSecret));
    }, [allPppoeSecrets, workspaceIds, recentlyDeleted]);

    const loading = workspaceIds.length > 0 && allSecrets.length === 0;



    // ── Sorting ───────────────────────────────────────────────────────────────
    const handleSort = (column: string) => {
        if (sortColumn === column) {
            setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
        } else {
            setSortColumn(column);
            setSortDirection('asc');
        }
    };

    // ── Filtering & Sorting (IDENTIK dengan Management Table) ─────────────────
    const filteredSecrets = useMemo(() => {
        let filtered = allSecrets;

        if (activeFilter === 'active') {
            filtered = filtered.filter(s => s.isActive && s.disabled === 'false');
        } else if (activeFilter === 'inactive') {
            filtered = filtered.filter(s => !s.isActive);
        } else if (activeFilter === 'isolate') {
            filtered = filtered.filter(s => s.profile.toLowerCase() === 'isolir');
        }

        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase().trim();
            filtered = filtered.filter(s =>
                s.name.toLowerCase().includes(query) ||
                s.profile.toLowerCase().includes(query) ||
                (s['remote-address'] || '').toLowerCase().includes(query) ||
                (s.workspace_name || '').toLowerCase().includes(query) ||
                (s.router_name || '').toLowerCase().includes(query)
            );
        }

        if (sortColumn) {
            filtered = [...filtered].sort((a, b) => {
                let aVal: any, bVal: any;
                switch (sortColumn) {
                    case 'status':
                        aVal = a.disabled === 'true' ? 0 : (a.isActive ? 1 : 2);
                        bVal = b.disabled === 'true' ? 0 : (b.isActive ? 1 : 2);
                        break;
                    case 'name':
                        aVal = a.name.toLowerCase();
                        bVal = b.name.toLowerCase();
                        break;
                    case 'workspace':
                        aVal = (a.router_name || a.workspace_name).toLowerCase();
                        bVal = (b.router_name || b.workspace_name).toLowerCase();
                        break;
                    case 'profile':
                        aVal = a.profile.toLowerCase();
                        bVal = b.profile.toLowerCase();
                        break;
                    case 'remote-address':
                        aVal = (a['remote-address'] || '').toLowerCase();
                        bVal = (b['remote-address'] || '').toLowerCase();
                        break;
                    default: return 0;
                }
                if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
                if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
                return 0;
            });
        }

        return filtered;
    }, [allSecrets, activeFilter, searchQuery, sortColumn, sortDirection]);

    // ── Pagination ────────────────────────────────────────────────────────────
    const totalPages = Math.max(1, Math.ceil(filteredSecrets.length / ITEMS_PER_PAGE));
    const paginatedSecrets = useMemo(() => {
        const start = (currentPage - 1) * ITEMS_PER_PAGE;
        return filteredSecrets.slice(start, start + ITEMS_PER_PAGE);
    }, [filteredSecrets, currentPage]);

    // ── Summary Cards ─────────────────────────────────────────────────────────
    const summary = useMemo(() => {
        const total = allSecrets.length;
        const active = allSecrets.filter(s => s.isActive && s.disabled === 'false').length;
        const isolate = allSecrets.filter(s => s.profile.toLowerCase() === 'isolir').length;
        return { total, active, inactive: Math.max(0, total - active), isolate };
    }, [allSecrets]);

    // ── Actions ───────────────────────────────────────────────────────────────
    const handleAction = useCallback(async (action: 'enable' | 'disable' | 'kick' | 'isolate' | 'unisolate', secret: PppoeSecret) => {
        setIsActionLoading(true);
        const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
        const toastId = toast.loading(`Memproses ${action} untuk ${secret.name}...`);
        try {
            if (action === 'isolate' || action === 'unisolate') {
                const res = await apiFetch(`${apiUrl}/api/pppoe/secrets/${encodeURIComponent(secret.name)}/${action}?workspaceId=${secret.workspace_id}&deviceId=${secret.deviceId}`, { method: 'POST' });
                if (!res.ok) { const e = await res.json(); throw new Error(e.message); }
                toast.success(action === 'isolate' ? "User Berhasil Di-Isolir" : "Isolir Berhasil Dibuka", { id: toastId, description: `${secret.name}` });
            } else if (action === 'kick') {
                if (!secret.isActive) throw new Error("User tidak aktif.");
                if (!secret.activeConnectionId) throw new Error("ID koneksi tidak ditemukan.");
                const res = await apiFetch(`${apiUrl}/api/pppoe/active/${encodeURIComponent(secret.activeConnectionId)}/kick?workspaceId=${secret.workspace_id}&deviceId=${secret.deviceId}`, { method: 'POST' });
                if (!res.ok) { const e = await res.json(); throw new Error(e.message); }
                toast.success("Kick Berhasil", { id: toastId, description: `${secret.name} telah di-kick.` });
            } else if (action === 'disable') {
                const res = await apiFetch(`${apiUrl}/api/pppoe/secrets/${encodeURIComponent(secret.name)}/status?workspaceId=${secret.workspace_id}&deviceId=${secret.deviceId}`, { method: 'PUT', body: JSON.stringify({ disabled: 'yes' }) });
                if (!res.ok) { const e = await res.json(); throw new Error(e.message); }
                if (secret.isActive && secret.activeConnectionId) {
                    try { await apiFetch(`${apiUrl}/api/pppoe/active/${encodeURIComponent(secret.activeConnectionId)}/kick?workspaceId=${secret.workspace_id}&deviceId=${secret.deviceId}`, { method: 'POST' }); } catch { }
                }
                toast.success("Disable Berhasil", { id: toastId, description: `${secret.name} di-disable.` });
            } else {
                const res = await apiFetch(`${apiUrl}/api/pppoe/secrets/${encodeURIComponent(secret.name)}/status?workspaceId=${secret.workspace_id}&deviceId=${secret.deviceId}`, { method: 'PUT', body: JSON.stringify({ disabled: 'no' }) });
                if (!res.ok) { const e = await res.json(); throw new Error(e.message); }
                toast.success("Enable Berhasil", { id: toastId, description: `${secret.name} di-enable.` });
            }
        } catch (err: any) {
            toast.error("Gagal", { id: toastId, description: err.message });
        } finally {
            setIsActionLoading(false);
        }
    }, []);

    const handleEditClick = useCallback((user: PppoeSecret) => { setSecretToEdit(user); setIsEditModalOpen(true); }, []);
    const handleDeleteClick = useCallback((user: PppoeSecret) => { setSecretToDelete(user); setIsDeleteModalOpen(true); }, []);

    const handleDeleteConfirm = useCallback(async () => {
        if (!secretToDelete) return;
        setIsActionLoading(true);
        const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
        const toastId = toast.loading(`Menghapus ${secretToDelete.name}...`);
        try {
            const res = await apiFetch(`${apiUrl}/api/pppoe/secrets/${encodeURIComponent(secretToDelete.name)}?workspaceId=${secretToDelete.workspace_id}&deviceId=${secretToDelete.deviceId}`, { method: 'DELETE' });
            if (!res.ok) throw new Error("Gagal menghapus");
            setRecentlyDeleted(prev => { const next = new Set(prev); next.add(`${secretToDelete.deviceId}-${secretToDelete.name}`); return next; });
            toast.success("Berhasil Menghapus Secret", { id: toastId });
        } catch (err: any) {
            toast.error("Gagal Menghapus", { id: toastId, description: err.message });
        } finally {
            setIsActionLoading(false);
            setIsDeleteModalOpen(false);
            setSecretToDelete(null);
        }
    }, [secretToDelete]);

    // ── Summary Card Helper ───────────────────────────────────────────────────
    const renderSummaryCard = (title: string, count: number, icon: React.ReactNode, color: string, filter: 'all' | 'active' | 'inactive' | 'isolate') => (
        <button onClick={() => setActiveFilter(filter)} className={`w-full text-left rounded-lg transition-all ${activeFilter === filter ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''}`}>
            <SummaryCard title={title} count={loading && allSecrets.length === 0 ? <Loader2 className="animate-spin" /> : count} icon={icon} colorClass={color} />
        </button>
    );

    // ── JSX ───────────────────────────────────────────────────────────────────
    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-4">
                {renderSummaryCard("Total", summary.total, <Users />, "bg-gradient-to-br from-blue-500 to-blue-700", 'all')}
                {renderSummaryCard("Aktif", summary.active, <UserCheck />, "bg-gradient-to-br from-green-500 to-green-700", 'active')}
                {renderSummaryCard("Tidak Aktif", summary.inactive, <UserX />, "bg-gradient-to-br from-red-500 to-red-700", 'inactive')}
                {renderSummaryCard("Isolir", summary.isolate, <ShieldAlert />, "bg-gradient-to-br from-orange-500 to-orange-700", 'isolate')}
            </div>

            <Card>
                <CardHeader>
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <CardTitle className="text-lg sm:text-xl">
                            Secret PPPoE ({loading && allSecrets.length === 0 ? '...' : filteredSecrets.length})
                        </CardTitle>
                        <div className="flex items-center gap-2">
                            <div className="relative flex-1 sm:w-64">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                    type="text"
                                    placeholder="Cari nama, profil, IP, router..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="pl-9 pr-8 bg-input h-9"
                                />
                                {searchQuery && (
                                    <button
                                        type="button"
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                        onClick={() => setSearchQuery('')}
                                    >
                                        <X size={14} />
                                    </button>
                                )}
                            </div>
                            <Button
                                size="sm"
                                className="shrink-0"
                                onClick={() => {
                                    if (workspaces.length === 1) {
                                        setSelectedWorkspaceForAdd(workspaces[0].id);
                                        setIsAddModalOpen(true);
                                    } else {
                                        setIsNocWorkspaceSelectorOpen(true);
                                    }
                                }}
                            >
                                <Plus className="h-4 w-4 mr-1 sm:mr-2" />
                                <span className="hidden sm:inline">Tambah</span>
                            </Button>
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
                                {loading && allSecrets.length === 0 ? (
                                    <tr><td colSpan={7} className="text-center p-10"><Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" /></td></tr>
                                ) : paginatedSecrets.length > 0 ? (
                                    paginatedSecrets.map((user) => {
                                        const uniqueKey = user['.id'] || user.name;
                                        return (
                                            <tr
                                                key={`${user.workspace_id}-${user.deviceId}-${uniqueKey}`}
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
                                                            <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">{user.profile}</span>
                                                            {user['remote-address'] ? (
                                                                <a href={`http://${user['remote-address']}`} target="_blank" rel="noopener noreferrer" className="text-[10px] text-primary/80 font-mono truncate max-w-[120px] underline hover:text-primary">{user['remote-address']}</a>
                                                            ) : (
                                                                <span className="text-[10px] text-muted-foreground font-mono">No IP</span>
                                                            )}
                                                            <span className="text-[10px] text-muted-foreground md:hidden truncate max-w-[120px]">{user.router_name || user.workspace_name}</span>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="p-2 sm:p-4 hidden md:table-cell">
                                                    <span className="inline-flex items-center px-2 py-1 rounded-full text-[10px] font-medium bg-primary/10 text-primary truncate max-w-[120px] lg:max-w-[180px]">
                                                        {user.router_name || user.workspace_name}
                                                    </span>
                                                </td>
                                                <td className="p-2 sm:p-4 hidden sm:table-cell">
                                                    <span className="truncate max-w-[100px] lg:max-w-[150px] block">{user.profile}</span>
                                                </td>
                                                <td className="p-2 sm:p-4 hidden lg:table-cell">
                                                    {user['remote-address'] ? (
                                                        <a href={`http://${user['remote-address']}`} target="_blank" rel="noopener noreferrer" className="text-[10px] text-primary/80 font-mono underline hover:text-primary">{user['remote-address']}</a>
                                                    ) : (
                                                        <span className="text-[10px] text-muted-foreground font-mono">-</span>
                                                    )}
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
                                                                    <PowerOff className="mr-2 h-4 w-4 text-green-500" /> Buka Isolir
                                                                </DropdownMenuItem>
                                                            ) : (
                                                                <DropdownMenuItem onClick={() => handleAction('isolate', user)}>
                                                                    <PowerOff className="mr-2 h-4 w-4 text-orange-500" /> Isolir User
                                                                </DropdownMenuItem>
                                                            )}
                                                            <DropdownMenuSeparator />
                                                            {user.isActive && (
                                                                <DropdownMenuItem onClick={() => handleAction('kick', user)}>
                                                                    <PowerOff className="mr-2 h-4 w-4" /> Kick User
                                                                </DropdownMenuItem>
                                                            )}
                                                            {user.disabled === 'true' ?
                                                                (<DropdownMenuItem onClick={() => handleAction('enable', user)}><Power className="mr-2 h-4 w-4" /> Enable</DropdownMenuItem>) :
                                                                (<DropdownMenuItem onClick={() => handleAction('disable', user)}><PowerOff className="mr-2 h-4 w-4" /> Disable</DropdownMenuItem>)
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
                                    <tr><td colSpan={7} className="text-center p-10 text-muted-foreground">
                                        {searchQuery ? `Tidak ada hasil untuk "${searchQuery}"` : 'Tidak ada data secret.'}
                                    </td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                    {/* Pagination */}
                    {filteredSecrets.length > ITEMS_PER_PAGE && (
                        <div className="flex items-center justify-between px-4 py-3 border-t">
                            <span className="text-xs text-muted-foreground">
                                Menampilkan {((currentPage - 1) * ITEMS_PER_PAGE) + 1}–{Math.min(currentPage * ITEMS_PER_PAGE, filteredSecrets.length)} dari {filteredSecrets.length}
                            </span>
                            <div className="flex items-center gap-1">
                                <Button
                                    variant="outline" size="sm" disabled={currentPage <= 1}
                                    onClick={() => { setCurrentPage(p => p - 1); tableContainerRef.current?.scrollTo(0, 0); }}
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                </Button>
                                <span className="text-xs px-2">{currentPage} / {totalPages}</span>
                                <Button
                                    variant="outline" size="sm" disabled={currentPage >= totalPages}
                                    onClick={() => { setCurrentPage(p => p + 1); tableContainerRef.current?.scrollTo(0, 0); }}
                                >
                                    <ChevronRight className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            <ConfirmModal
                isOpen={isDeleteModalOpen}
                onClose={() => setIsDeleteModalOpen(false)}
                onConfirm={handleDeleteConfirm}
                title="Hapus Secret PPPoE"
                description={`Hapus secret "${secretToDelete?.name}" dari ${secretToDelete?.workspace_name}? Tindakan ini tidak dapat dibatalkan.`}
                confirmText="Hapus"
                isLoading={isActionLoading}
            />

            {isEditModalOpen && secretToEdit && (
                <EditPppoeSecretModal
                    isOpen={isEditModalOpen}
                    onClose={() => setIsEditModalOpen(false)}
                    secretToEdit={memoizedSecretToEdit}
                    onSuccess={() => setIsEditModalOpen(false)}
                    nocWorkspaceId={secretToEdit.workspace_id}
                />
            )}

            <AddPppoeSecretModal
                isOpen={isAddModalOpen}
                onClose={() => setIsAddModalOpen(false)}
                onSuccess={() => setIsAddModalOpen(false)}
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
