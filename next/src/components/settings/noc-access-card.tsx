'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, UserPlus, UserMinus, Loader2, Search, User } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import ConfirmModal from '@/components/ui/confirm-modal';
import { apiFetch } from '@/utils/api';
import { useAuth } from '../providers/auth-provider';

interface NocUser {
    id: number;
    username: string;
    display_name: string;
    whatsapp_number: string;
    created_at: string;
}

const NocAccessCard = () => {
    const { user: currentUser } = useAuth();
    const [nocUsers, setNocUsers] = useState<NocUser[]>([]);
    const [loading, setLoading] = useState(true);
    const [addingUsername, setAddingUsername] = useState('');
    const [isAdding, setIsAdding] = useState(false);
    const [revokingId, setRevokingId] = useState<number | null>(null);
    const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;

    const isAdmin = currentUser?.role === 'admin' || currentUser?.is_super_admin;

    const fetchNocUsers = useCallback(async () => {
        if (!currentUser?.workspace_id) return;
        setLoading(true);
        try {
            const res = await apiFetch(`${apiUrl}/api/noc/permissions?workspaceId=${currentUser.workspace_id}`);
            if (res.ok) {
                const data = await res.json();
                setNocUsers(data);
            }
        } catch (error) {
            console.error("Gagal ambil daftar user NOC:", error);
        } finally {
            setLoading(false);
        }
    }, [apiUrl, currentUser?.workspace_id]);

    useEffect(() => {
        fetchNocUsers();
    }, [fetchNocUsers]);

    const handleGrantAccess = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!addingUsername.trim() || !currentUser?.workspace_id) return;

        setIsAdding(true);
        try {
            const res = await apiFetch(`${apiUrl}/api/noc/permissions/grant`, {
                method: 'POST',
                body: JSON.stringify({
                    username: addingUsername.trim(),
                    workspaceId: currentUser.workspace_id
                })
            });
            const data = await res.json();
            if (res.ok) {
                toast.success("Akses NOC Diberikan", { description: data.message });
                setAddingUsername('');
                fetchNocUsers();
            } else {
                throw new Error(data.message);
            }
        } catch (error: any) {
            toast.error("Gagal Menambah Akses", { description: error.message });
        } finally {
            setIsAdding(false);
        }
    };

    const handleRevokeClick = (user: NocUser) => {
        setRevokingId(user.id);
    };

    const executeRevoke = async () => {
        if (!revokingId || !currentUser?.workspace_id) return;
        try {
            const res = await apiFetch(`${apiUrl}/api/noc/permissions/revoke`, {
                method: 'POST',
                body: JSON.stringify({
                    userId: revokingId,
                    workspaceId: currentUser.workspace_id
                })
            });
            if (res.ok) {
                toast.success("Akses NOC Dicabut");
                fetchNocUsers();
            } else {
                const data = await res.json();
                throw new Error(data.message);
            }
        } catch (error: any) {
            toast.error("Gagal Mencabut Akses", { description: error.message });
        } finally {
            setRevokingId(null);
        }
    };

    if (!isAdmin) return null;

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <ShieldCheck className="text-primary" /> Izin Akses NOC
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
                <p className="text-sm text-muted-foreground">
                    Berikan izin kepada user lain untuk memantau workspace ini melalui halaman NOC. 
                    User yang diberikan akses akan otomatis mendapatkan role <strong>NOC</strong> dan bisa membantu operasional seperti isolir dan kick user.
                </p>

                <form onSubmit={handleGrantAccess} className="flex gap-2">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Masukkan Username atau WhatsApp..."
                            value={addingUsername}
                            onChange={(e) => setAddingUsername(e.target.value)}
                            className="pl-9 h-10"
                            disabled={isAdding}
                        />
                    </div>
                    <Button type="submit" disabled={isAdding || !addingUsername.trim()}>
                        {isAdding ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : <UserPlus className="mr-2 h-4 w-4" />}
                        Tambah
                    </Button>
                </form>

                <div className="space-y-4">
                    <h4 className="text-sm font-semibold flex items-center gap-2">
                        Daftar User NOC Terdaftar <span className="bg-secondary px-2 py-0.5 rounded-full text-[10px]">{nocUsers.length}</span>
                    </h4>

                    {loading ? (
                        <div className="flex justify-center p-4">
                            <Loader2 className="animate-spin text-muted-foreground" />
                        </div>
                    ) : (
                        <div className="divide-y border rounded-lg">
                            {nocUsers.map((user) => (
                                <div key={user.id} className="p-3 flex items-center justify-between hover:bg-muted/30 transition-colors">
                                    <div className="flex items-center gap-3">
                                        <div className="bg-primary/10 p-2 rounded-full">
                                            <User size={16} className="text-primary" />
                                        </div>
                                        <div>
                                            <h5 className="text-sm font-medium">{user.display_name}</h5>
                                            <p className="text-xs text-muted-foreground">@{user.username}</p>
                                        </div>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="text-destructive hover:text-destructive hover:bg-destructive/10 h-8"
                                        onClick={() => handleRevokeClick(user)}
                                    >
                                        <UserMinus size={14} className="mr-1.5" /> Cabut Akses
                                    </Button>
                                </div>
                            ))}
                            {nocUsers.length === 0 && (
                                <div className="p-8 text-center text-sm text-muted-foreground italic">
                                    Belum ada staf NOC yang didaftarkan untuk workspace ini.
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </CardContent>

            <ConfirmModal
                isOpen={!!revokingId}
                onClose={() => setRevokingId(null)}
                onConfirm={executeRevoke}
                title="Cabut Akses NOC"
                description="Apakah Anda yakin ingin mencabut izin akses NOC untuk user ini? Mereka tidak akan bisa lagi melihat workspace ini di halaman NOC."
                confirmText="Ya, Cabut"
                isLoading={false}
            />
        </Card>
    );
};

export default NocAccessCard;
