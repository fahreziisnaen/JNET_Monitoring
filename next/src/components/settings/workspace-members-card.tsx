'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Users, UserMinus, Shield, ShieldCheck, ShieldAlert, Loader2, ArrowRightLeft, Globe, ChevronDown, Check } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import ConfirmModal from '@/components/ui/confirm-modal';
import { 
    DropdownMenu, 
    DropdownMenuTrigger, 
    DropdownMenuContent, 
    DropdownMenuItem, 
    DropdownMenuLabel, 
    DropdownMenuSeparator 
} from '@/components/ui/dropdown-menu';
import { apiFetch } from '@/utils/api';
import { useAuth } from '../providers/auth-provider';

interface Member {
    id: number;
    username: string;
    display_name: string;
    role: 'admin' | 'user' | 'noc';
    profile_picture_url: string;
    is_owner: number | boolean;
    workspace_id?: number;
    workspace_name?: string;
    is_super_admin?: boolean;
}

const WorkspaceMembersCard = () => {
    const { user: currentUser } = useAuth();
    const [members, setMembers] = useState<Member[]>([]);
    const [allUsers, setAllUsers] = useState<Member[]>([]);
    const [loading, setLoading] = useState(true);
    const [kickingId, setKickingId] = useState<number | null>(null);
    const [togglingRoleId, setTogglingRoleId] = useState<number | null>(null);
    const [viewMode, setViewMode] = useState<'workspace' | 'all'>('workspace');
    const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;

    const isSuperAdmin = currentUser?.is_super_admin;
    const isAdmin = currentUser?.role === 'admin';

    const fetchMembers = useCallback(async () => {
        setLoading(true);
        try {
            const res = await apiFetch(`${apiUrl}/api/workspaces/members`);
            if (res.ok) {
                const data = await res.json();
                setMembers(data);
            }
        } catch (error) {
            console.error("Gagal ambil daftar anggota:", error);
        } finally {
            setLoading(false);
        }
    }, [apiUrl]);

    const fetchAllUsers = useCallback(async () => {
        if (!isSuperAdmin) return;
        setLoading(true);
        try {
            const res = await apiFetch(`${apiUrl}/api/workspaces/all-users`);
            if (res.ok) {
                const data = await res.json();
                setAllUsers(data);
            }
        } catch (error) {
            console.error("Gagal ambil daftar semua user:", error);
        } finally {
            setLoading(false);
        }
    }, [apiUrl, isSuperAdmin]);

    useEffect(() => {
        if (viewMode === 'workspace') {
            fetchMembers();
        } else {
            fetchAllUsers();
        }
    }, [viewMode, fetchMembers, fetchAllUsers]);

    // Confirm Modal State
    const [confirmConfig, setConfirmConfig] = useState({
        isOpen: false,
        title: '',
        description: '',
        confirmText: 'Konfirmasi',
        action: async () => { }, // Placeholder
        isLoading: false
    });

    const openConfirm = (title: string, description: string, confirmText: string, action: () => Promise<void>) => {
        setConfirmConfig({
            isOpen: true,
            title,
            description,
            confirmText,
            action,
            isLoading: false
        });
    };

    const handleConfirmAction = async () => {
        setConfirmConfig(prev => ({ ...prev, isLoading: true }));
        try {
            await confirmConfig.action();
            setConfirmConfig(prev => ({ ...prev, isOpen: false }));
        } catch (error) {
            console.error(error);
        } finally {
            setConfirmConfig(prev => ({ ...prev, isLoading: false }));
        }
    };

    const handleKickClick = (member: Member) => {
        openConfirm(
            "Keluarkan Anggota",
            `Apakah Anda yakin ingin mengeluarkan ${member.display_name} (@${member.username}) dari workspace ini?`,
            "Ya, Keluarkan",
            () => executeKick(member)
        );
    };

    const executeKick = async (member: Member) => {
        setKickingId(member.id);
        try {
            const res = await apiFetch(`${apiUrl}/api/workspaces/members/${member.id}`, {
                method: 'DELETE'
            });
            const data = await res.json();
            if (res.ok) {
                toast.success("Anggota Dikeluarkan", { description: data.message });
                fetchMembers();
            } else {
                throw new Error(data.message);
            }
        } catch (error: any) {
            toast.error("Gagal Mengeluarkan Anggota", { description: error.message });
        } finally {
            setKickingId(null);
        }
    };

    const handleRoleChange = (member: Member, newRole: 'admin' | 'user' | 'noc') => {
        if (member.role === newRole) return;
        
        const labels: Record<string, string> = {
            'admin': 'Admin',
            'noc': 'NOC',
            'user': 'User'
        };

        openConfirm(
            "Ubah Role Anggota",
            `Ubah role ${member.display_name} menjadi ${labels[newRole]}?`,
            "Ya, Ubah Role",
            () => executeToggleRole(member, newRole)
        );
    };

    const executeToggleRole = async (member: Member, newRole: 'admin' | 'user' | 'noc') => {
        setTogglingRoleId(member.id);
        try {
            const res = await apiFetch(`${apiUrl}/api/workspaces/members/${member.id}/role`, {
                method: 'PATCH',
                body: JSON.stringify({ role: newRole })
            });
            const data = await res.json();
            if (res.ok) {
                // Update local state
                if (viewMode === 'workspace') {
                    setMembers(prev => prev.map(m => m.id === member.id ? { ...m, role: newRole } : m));
                } else {
                    setAllUsers(prev => prev.map(m => m.id === member.id ? { ...m, role: newRole } : m));
                }
                toast.success("Role Berhasil Diubah", { description: `Role ${member.display_name} diubah menjadi ${newRole}.` });
            } else {
                throw new Error(data.message);
            }
        } catch (error: any) {
            toast.error("Gagal Mengubah Role", { description: error.message });
        } finally {
            setTogglingRoleId(null);
        }
    };

    const getRoleBadge = (member: Member) => {
        const badges = [];
        
        if (member.is_super_admin) {
            badges.push(
                <span key="superadmin" className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-purple-500/10 text-purple-600 px-2 py-0.5 rounded-full border border-purple-500/20">
                    <ShieldAlert size={10} /> Superadmin
                </span>
            );
        }
        
        if (member.is_owner) {
            badges.push(
                <span key="owner" className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-600 px-2 py-0.5 rounded-full border border-amber-500/20">
                    <ShieldAlert size={10} /> Owner
                </span>
            );
        }
        
        if (member.role === 'admin' && !member.is_super_admin) {
            badges.push(
                <span key="admin" className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-blue-500/10 text-blue-600 px-2 py-0.5 rounded-full border border-blue-500/20">
                    <ShieldCheck size={10} /> Admin
                </span>
            );
        }
        
        if (member.role === 'noc') {
            badges.push(
                <span key="noc" className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-600 px-2 py-0.5 rounded-full border border-emerald-500/20">
                    <ShieldCheck size={10} /> NOC
                </span>
            );
        }

        if (badges.length === 0) {
            badges.push(
                <span key="user" className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-slate-500/10 text-slate-600 px-2 py-0.5 rounded-full border border-slate-500/20">
                    <Shield size={10} /> User
                </span>
            );
        }

        return <div className="flex gap-1 items-center flex-wrap">{badges}</div>;
    };

    const canManageRole = (member: Member) => {
        // Tidak bisa ubah role sendiri
        if (member.id === currentUser?.id) return false;
        // Tidak bisa ubah role owner
        if (member.is_owner) return false;
        // Super admin bisa ubah siapapun
        if (isSuperAdmin) return true;
        // Admin biasa bisa ubah role member di workspace yang sama
        if (isAdmin) return true;
        return false;
    };

    const canKick = (member: Member) => {
        if (member.id === currentUser?.id) return false;
        if (member.is_owner) return false;
        if (!isAdmin) return false;
        // Hanya bisa kick member workspace sendiri (bukan mode all)
        if (viewMode === 'all') return false;
        return true;
    };

    const renderMemberRow = (member: Member, showWorkspace = false) => (
        <div key={member.id} className="py-4 flex items-center justify-between group">
            <div className="flex items-center gap-4">
                <div className="relative">
                    <img
                        src={member.profile_picture_url ? `${apiUrl}${member.profile_picture_url}` : `${apiUrl}/public/uploads/avatars/default.jpg`}
                        alt={member.display_name}
                        className="w-10 h-10 rounded-full object-cover border-2 border-background shadow-sm"
                        onError={(e) => {
                            (e.target as HTMLImageElement).src = `${apiUrl}/public/uploads/avatars/default.jpg`;
                        }}
                    />
                    {member.is_super_admin && member.is_owner ? (
                        <div className="absolute -bottom-1 -right-1 flex -space-x-1">
                            <div className="bg-purple-500 rounded-full p-0.5 text-white border-2 border-background z-10">
                                <ShieldAlert size={8} />
                            </div>
                            <div className="bg-amber-500 rounded-full p-0.5 text-white border-2 border-background">
                                <ShieldAlert size={8} />
                            </div>
                        </div>
                    ) : member.is_super_admin ? (
                        <div className="absolute -bottom-1 -right-1 bg-purple-500 rounded-full p-0.5 text-white border-2 border-background">
                            <ShieldAlert size={8} />
                        </div>
                    ) : member.is_owner ? (
                        <div className="absolute -bottom-1 -right-1 bg-amber-500 rounded-full p-0.5 text-white border-2 border-background">
                            <ShieldAlert size={8} />
                        </div>
                    ) : member.role === 'admin' ? (
                        <div className="absolute -bottom-1 -right-1 bg-blue-500 rounded-full p-0.5 text-white border-2 border-background">
                            <ShieldCheck size={8} />
                        </div>
                    ) : member.role === 'noc' ? (
                        <div className="absolute -bottom-1 -right-1 bg-emerald-500 rounded-full p-0.5 text-white border-2 border-background">
                            <ShieldCheck size={8} />
                        </div>
                    ) : null}
                </div>
                <div>
                    <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-sm font-semibold">{member.display_name}</h4>
                        {getRoleBadge(member)}
                        {member.id === currentUser?.id && (
                            <span className="text-[10px] bg-secondary px-1.5 py-0.5 rounded text-muted-foreground uppercase font-medium">Anda</span>
                        )}
                    </div>
                    <p className="text-xs text-muted-foreground">@{member.username}</p>
                    {showWorkspace && member.workspace_name && (
                        <p className="text-xs text-primary/70 mt-0.5">{member.workspace_name}</p>
                    )}
                </div>
            </div>

            <div className="flex items-center gap-1 sm:gap-2">
                {canManageRole(member) && (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-8 text-[11px] font-bold border-primary/20 bg-secondary/30 hover:bg-secondary/50 flex items-center gap-1 px-2"
                                disabled={togglingRoleId === member.id}
                            >
                                {togglingRoleId === member.id ? (
                                    <Loader2 size={12} className="animate-spin" />
                                ) : (
                                    <ArrowRightLeft size={12} className="text-primary" />
                                )}
                                <span className="uppercase">
                                    {member.role === 'admin' ? 'Admin' : member.role === 'noc' ? 'NOC' : 'User'}
                                </span>
                                <ChevronDown size={10} className="opacity-50" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-[120px]">
                            <DropdownMenuLabel className="text-[10px] uppercase text-muted-foreground font-bold">Ubah Role</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => handleRoleChange(member, 'user')} className="text-xs flex justify-between">
                                User {member.role === 'user' && <Check size={12} className="text-primary" />}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleRoleChange(member, 'noc')} className="text-xs flex justify-between">
                                NOC {member.role === 'noc' && <Check size={12} className="text-primary" />}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleRoleChange(member, 'admin')} className="text-xs flex justify-between">
                                Admin {member.role === 'admin' && <Check size={12} className="text-primary" />}
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}

                {canKick(member) && (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-destructive hover:text-destructive hover:bg-destructive/10 px-2 sm:px-3"
                        onClick={() => handleKickClick(member)}
                        disabled={kickingId === member.id}
                        title="Keluarkan dari Workspace"
                    >
                        {kickingId === member.id ? <Loader2 size={14} className="animate-spin" /> : <UserMinus size={14} />}
                        <span className="ml-2 hidden sm:inline text-xs font-bold uppercase">Keluarkan</span>
                    </Button>
                )}
            </div>
        </div>
    );

    // Group all users by workspace for super admin view
    const groupedUsers = allUsers.reduce((acc, user) => {
        const wsName = user.workspace_name || 'Tanpa Workspace';
        if (!acc[wsName]) acc[wsName] = [];
        acc[wsName].push(user);
        return acc;
    }, {} as Record<string, Member[]>);

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                        <Users className="text-primary" /> Anggota Workspace
                    </CardTitle>
                    {isSuperAdmin && (
                        <div className="flex bg-secondary rounded-lg p-0.5">
                            <button
                                onClick={() => setViewMode('workspace')}
                                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${viewMode === 'workspace'
                                    ? 'bg-background text-foreground shadow-sm'
                                    : 'text-muted-foreground hover:text-foreground'
                                    }`}
                            >
                                Workspace Ini
                            </button>
                            <button
                                onClick={() => setViewMode('all')}
                                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all flex items-center gap-1 ${viewMode === 'all'
                                    ? 'bg-background text-foreground shadow-sm'
                                    : 'text-muted-foreground hover:text-foreground'
                                    }`}
                            >
                                <Globe size={12} /> Semua User
                            </button>
                        </div>
                    )}
                </div>
            </CardHeader>
            <CardContent>
                {loading ? (
                    <div className="flex justify-center p-8">
                        <Loader2 className="animate-spin text-muted-foreground" />
                    </div>
                ) : viewMode === 'workspace' ? (
                    <div className="space-y-4">
                        <p className="text-sm text-muted-foreground mb-4">
                            Daftar pengguna yang memiliki akses ke workspace ini. {isAdmin ? 'Hover untuk mengelola role atau mengeluarkan anggota.' : ''}
                        </p>

                        <div className="divide-y divide-border">
                            {members.map((member) => renderMemberRow(member))}
                        </div>

                        {members.length === 0 && (
                            <p className="text-center py-8 text-muted-foreground text-sm italic">
                                Tidak ada anggota ditemukan.
                            </p>
                        )}
                    </div>
                ) : (
                    <div className="space-y-6">
                        <p className="text-sm text-muted-foreground mb-4">
                            Semua user dari seluruh workspace. Hover untuk mengubah role.
                        </p>

                        {Object.entries(groupedUsers).map(([wsName, users]) => (
                            <div key={wsName}>
                                <h3 className="text-sm font-semibold text-primary mb-2 flex items-center gap-2">
                                    <span className="bg-primary-100 text-primary px-2 py-0.5 rounded-md text-xs">{wsName}</span>
                                    <span className="text-xs text-muted-foreground font-normal">{users.length} user</span>
                                </h3>
                                <div className="divide-y divide-border ml-2 border-l-2 border-primary/10 pl-4">
                                    {users.map((user) => renderMemberRow(user, false))}
                                </div>
                            </div>
                        ))}

                        {allUsers.length === 0 && (
                            <p className="text-center py-8 text-muted-foreground text-sm italic">
                                Tidak ada user ditemukan.
                            </p>
                        )}
                    </div>
                )}

            </CardContent>

            <ConfirmModal
                isOpen={confirmConfig.isOpen}
                onClose={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))}
                onConfirm={handleConfirmAction}
                title={confirmConfig.title}
                description={confirmConfig.description}
                confirmText={confirmConfig.confirmText}
                isLoading={confirmConfig.isLoading}
            />
        </Card >
    );
};

export default WorkspaceMembersCard;
