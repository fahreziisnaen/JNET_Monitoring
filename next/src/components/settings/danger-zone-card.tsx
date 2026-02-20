'use client';

import React, { useState, useEffect } from 'react';
import { ShieldAlert, Loader2, RotateCcw, ChevronDown, Building2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import DeleteAccountModal from './delete-account-modal';
import FactoryResetModal from './factory-reset-modal';
import { useAuth } from '../providers/auth-provider';
import { apiFetch } from '@/utils/api';

const DangerZoneCard = () => {
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [isResetModalOpen, setIsResetModalOpen] = useState(false);
    const [deleteLoading, setDeleteLoading] = useState(false);
    const [resetLoading, setResetLoading] = useState(false);
    const { logout, user } = useAuth();

    const [workspaces, setWorkspaces] = useState<any[]>([]);
    const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<number | null>(null);

    useEffect(() => {
        if (user?.is_super_admin) {
            const fetchWorkspaces = async () => {
                try {
                    const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
                    const res = await apiFetch(`${apiUrl}/api/workspaces/all`);
                    if (res.ok) {
                        const data = await res.json();
                        setWorkspaces(data);
                        // Default ke workspace saat ini
                        setSelectedWorkspaceId(user.workspace_id);
                    }
                } catch (error) {
                    console.error('Gagal mengambil daftar workspace:', error);
                }
            };
            fetchWorkspaces();
        }
    }, [user?.is_super_admin, user?.workspace_id]);

    const handleConfirmDelete = async () => {
        // ... (tetap sama)
        setDeleteLoading(true);
        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
            const res = await apiFetch(`${apiUrl}/api/user`, {
                method: 'DELETE',
            });
            if (!res.ok) throw new Error('Gagal menghapus akun.');

            if (!res.ok) throw new Error('Gagal menghapus akun.');

            toast.success('Akun Berhasil Dihapus', {
                description: 'Akun Anda telah dihapus secara permanen.'
            });
            await logout();

        } catch (error) {
            toast.error('Gagal Menghapus Akun', {
                description: 'Terjadi kesalahan saat mencoba menghapus akun.'
            });
            setDeleteLoading(false);
        }
    };

    const handleConfirmReset = async () => {
        setResetLoading(true);
        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
            const res = await apiFetch(`${apiUrl}/api/backup/factory-reset`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    targetWorkspaceId: selectedWorkspaceId || user?.workspace_id
                })
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.message || 'Gagal melakukan factory reset.');
            }

            // Trigger file download from response
            const blob = await res.blob();
            const contentDisposition = res.headers.get('Content-Disposition');
            const filenameMatch = contentDisposition?.match(/filename="(.+)"/);
            const filename = filenameMatch ? filenameMatch[1] : `factory-reset-ws-${selectedWorkspaceId || user?.workspace_id}.zip`;

            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);

            setIsResetModalOpen(false);
            setIsResetModalOpen(false);

            toast.success('Factory Reset Berhasil', {
                description: `Backup untuk workspace ID ${selectedWorkspaceId || user?.workspace_id} telah diunduh.`
            });

            // Re-fetch workspaces if super admin (count might have changed, or just to refresh)
            if (user?.is_super_admin) window.location.reload();
            else window.location.reload();

        } catch (error: any) {
            toast.error('Gagal Factory Reset', {
                description: error.message
            });
        } finally {
            setResetLoading(false);
        }
    };

    // Tampilkan tombol reset jika Super Admin ATAU Owner
    const canReset = user?.is_super_admin || user?.is_owner;
    const selectedWorkspaceName = workspaces.find(w => w.id === selectedWorkspaceId)?.name || 'Pilih Workspace';

    return (
        <>
            <Card className="border-red-500/50 bg-red-900/10">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-red-500">
                        <ShieldAlert /> Zona Berbahaya
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                        Aksi di bawah ini bersifat permanen dan tidak dapat diurungkan.
                    </p>

                    {/* Factory Reset - Super Admin atau Owner */}
                    {canReset && (
                        <div className="flex flex-col gap-4 rounded-lg border border-red-500/20 p-4">
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <p className="font-medium text-sm">Factory Reset Workspace</p>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        Hapus semua data operasional (log, klien, aset, dll). Backup otomatis dibuat sebelum penghapusan.
                                    </p>
                                </div>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="shrink-0 border-red-500/50 text-red-500 hover:bg-red-500/10 hover:text-red-400"
                                    onClick={() => setIsResetModalOpen(true)}
                                    disabled={resetLoading}
                                >
                                    {resetLoading ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                        <>
                                            <RotateCcw className="mr-2 h-4 w-4" />
                                            Factory Reset
                                        </>
                                    )}
                                </Button>
                            </div>

                            {/* Dropdown Pilihan Workspace (Hanya Super Admin) */}
                            {user?.is_super_admin && workspaces.length > 0 && (
                                <div className="flex items-center gap-3 pt-2 border-t border-red-500/10">
                                    <Building2 className="h-4 w-4 text-muted-foreground" />
                                    <span className="text-xs font-medium text-muted-foreground">Target Workspace:</span>
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button variant="outline" size="sm" className="h-8 border-red-500/30 bg-transparent text-xs">
                                                {selectedWorkspaceName}
                                                <ChevronDown className="ml-2 h-3 w-3" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="start" className="max-h-[300px] overflow-y-auto">
                                            {workspaces.map((ws) => (
                                                <DropdownMenuItem
                                                    key={ws.id}
                                                    onClick={() => setSelectedWorkspaceId(ws.id)}
                                                    className={selectedWorkspaceId === ws.id ? 'bg-accent' : ''}
                                                >
                                                    {ws.name}
                                                    {selectedWorkspaceId === ws.id && <span className="ml-2 text-[10px]">✓</span>}
                                                </DropdownMenuItem>
                                            ))}
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Delete Account */}
                    <div className="flex items-start justify-between gap-4 rounded-lg border border-red-500/20 p-4">
                        <div>
                            <p className="font-medium text-sm">Hapus Akun Saya</p>
                            <p className="text-xs text-muted-foreground mt-1">
                                Hapus akun Anda secara permanen dari sistem.
                            </p>
                        </div>
                        <Button
                            variant="destructive"
                            size="sm"
                            className="shrink-0"
                            onClick={() => setIsDeleteModalOpen(true)}
                            disabled={deleteLoading}
                        >
                            {deleteLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Hapus Akun
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <DeleteAccountModal
                isOpen={isDeleteModalOpen}
                onClose={() => setIsDeleteModalOpen(false)}
                onConfirm={handleConfirmDelete}
            />

            <FactoryResetModal
                isOpen={isResetModalOpen}
                onClose={() => setIsResetModalOpen(false)}
                onConfirm={handleConfirmReset}
                isLoading={resetLoading}
            />
        </>
    );
};

export default DangerZoneCard;