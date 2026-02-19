'use client';

import React, { useState } from 'react';
import { ShieldAlert, Loader2, RotateCcw } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import DeleteAccountModal from './delete-account-modal';
import FactoryResetModal from './factory-reset-modal';
import { useAuth } from '../providers/auth-provider';
import { apiFetch } from '@/utils/api';

const DangerZoneCard = () => {
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [isResetModalOpen, setIsResetModalOpen] = useState(false);
    const [deleteLoading, setDeleteLoading] = useState(false);
    const [resetLoading, setResetLoading] = useState(false);
    const { logout } = useAuth();

    const handleConfirmDelete = async () => {
        setDeleteLoading(true);
        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
            const res = await apiFetch(`${apiUrl}/api/user`, {
                method: 'DELETE',
            });
            if (!res.ok) throw new Error('Gagal menghapus akun.');

            alert('Akun Anda telah berhasil dihapus.');
            await logout();

        } catch (error) {
            alert('Terjadi kesalahan saat mencoba menghapus akun.');
            setDeleteLoading(false);
        }
    };

    const handleConfirmReset = async () => {
        setResetLoading(true);
        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
            const res = await apiFetch(`${apiUrl}/api/backup/factory-reset`, {
                method: 'POST',
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.message || 'Gagal melakukan factory reset.');
            }

            // Trigger file download from response
            const blob = await res.blob();
            const contentDisposition = res.headers.get('Content-Disposition');
            const filenameMatch = contentDisposition?.match(/filename="(.+)"/);
            const filename = filenameMatch ? filenameMatch[1] : 'factory-reset-backup.zip';

            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);

            setIsResetModalOpen(false);
            alert('✅ Factory Reset berhasil! Backup telah diunduh. Semua data operasional telah dihapus.');
            window.location.reload();

        } catch (error: any) {
            alert(`❌ Gagal: ${error.message}`);
        } finally {
            setResetLoading(false);
        }
    };

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

                    {/* Factory Reset */}
                    <div className="flex items-start justify-between gap-4 rounded-lg border border-red-500/20 p-4">
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