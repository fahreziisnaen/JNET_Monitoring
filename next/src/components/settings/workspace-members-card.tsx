'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Users, UserMinus, Shield, ShieldCheck, ShieldAlert, Loader2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/utils/api';
import { useAuth } from '../providers/auth-provider';

interface Member {
    id: number;
    username: string;
    display_name: string;
    role: 'admin' | 'user';
    profile_picture_url: string;
    is_owner: number | boolean;
}

const WorkspaceMembersCard = () => {
    const { user: currentUser } = useAuth();
    const [members, setMembers] = useState<Member[]>([]);
    const [loading, setLoading] = useState(true);
    const [kickingId, setKickingId] = useState<number | null>(null);
    const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;

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

    useEffect(() => {
        fetchMembers();
    }, [fetchMembers]);

    const handleKick = async (member: Member) => {
        if (!confirm(`Apakah Anda yakin ingin mengeluarkan ${member.display_name} (@${member.username}) dari workspace ini?`)) {
            return;
        }

        setKickingId(member.id);
        try {
            const res = await apiFetch(`${apiUrl}/api/workspaces/members/${member.id}`, {
                method: 'DELETE'
            });
            const data = await res.json();
            if (res.ok) {
                alert(data.message);
                fetchMembers(); // Refresh list
            } else {
                throw new Error(data.message);
            }
        } catch (error: any) {
            alert(`Gagal mengeluarkan anggota: ${error.message}`);
        } finally {
            setKickingId(null);
        }
    };

    const getRoleBadge = (member: Member) => {
        if (member.is_owner) {
            return (
                <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-600 px-2 py-0.5 rounded-full border border-amber-500/20">
                    <ShieldAlert size={10} /> Owner
                </span>
            );
        }
        if (member.role === 'admin') {
            return (
                <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-blue-500/10 text-blue-600 px-2 py-0.5 rounded-full border border-blue-500/20">
                    <ShieldCheck size={10} /> Admin
                </span>
            );
        }
        return (
            <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-slate-500/10 text-slate-600 px-2 py-0.5 rounded-full border border-slate-500/20">
                <Shield size={10} /> User
            </span>
        );
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Users className="text-primary" /> Anggota Workspace
                </CardTitle>
            </CardHeader>
            <CardContent>
                {loading ? (
                    <div className="flex justify-center p-8">
                        <Loader2 className="animate-spin text-muted-foreground" />
                    </div>
                ) : (
                    <div className="space-y-4">
                        <p className="text-sm text-muted-foreground mb-4">
                            Daftar pengguna yang memiliki akses ke workspace ini. Hanya Admin yang dapat mengelola anggota.
                        </p>

                        <div className="divide-y divide-border">
                            {members.map((member) => (
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
                                            {member.is_owner ? (
                                                <div className="absolute -bottom-1 -right-1 bg-amber-500 rounded-full p-0.5 text-white border-2 border-background">
                                                    <ShieldAlert size={8} />
                                                </div>
                                            ) : member.role === 'admin' ? (
                                                <div className="absolute -bottom-1 -right-1 bg-blue-500 rounded-full p-0.5 text-white border-2 border-background">
                                                    <ShieldCheck size={8} />
                                                </div>
                                            ) : null}
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <h4 className="text-sm font-semibold">{member.display_name}</h4>
                                                {getRoleBadge(member)}
                                                {member.id === currentUser?.id && (
                                                    <span className="text-[10px] bg-secondary px-1.5 py-0.5 rounded text-muted-foreground uppercase font-medium">Anda</span>
                                                )}
                                            </div>
                                            <p className="text-xs text-muted-foreground">@{member.username}</p>
                                        </div>
                                    </div>

                                    {currentUser?.role === 'admin' && !member.is_owner && member.id !== currentUser.id && (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="text-destructive hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"
                                            onClick={() => handleKick(member)}
                                            disabled={kickingId === member.id}
                                        >
                                            {kickingId === member.id ? <Loader2 size={16} className="animate-spin" /> : <UserMinus size={16} />}
                                            <span className="ml-2 hidden sm:inline">Keluarkan</span>
                                        </Button>
                                    )}
                                </div>
                            ))}
                        </div>

                        {members.length === 0 && (
                            <p className="text-center py-8 text-muted-foreground text-sm italic">
                                Tidak ada anggota ditemukan.
                            </p>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
};

export default WorkspaceMembersCard;
