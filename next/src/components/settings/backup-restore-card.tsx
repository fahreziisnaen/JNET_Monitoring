'use client';

import React, { useState, useRef } from 'react';
import { Database, Download, Upload, AlertTriangle, Loader2, CheckCircle2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { apiFetch, getAuthToken } from '@/utils/api';
import { useAuth } from '@/components/providers/auth-provider';
import ConfirmModal from '@/components/ui/confirm-modal';

const BackupRestoreCard = () => {
    const { user } = useAuth();
    const [exporting, setExporting] = useState(false);
    const [restoring, setRestoring] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [workspaces, setWorkspaces] = useState<any[]>([]);
    const [exportId, setExportId] = useState<string>('current');
    const [restoreId, setRestoreId] = useState<string>('current');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;

    // State for ConfirmModal
    const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
    const [confirmTitle, setConfirmTitle] = useState('');
    const [confirmDescription, setConfirmDescription] = useState('');
    const [pendingFile, setPendingFile] = useState<File | null>(null);

    // Load workspaces for Super Admin
    React.useEffect(() => {
        if (user?.is_super_admin) {
            const fetchWorkspaces = async () => {
                try {
                    const res = await apiFetch(`${apiUrl}/api/workspaces/all`);
                    if (res.ok) {
                        const data = await res.json();
                        setWorkspaces(data);
                    }
                } catch (err) {
                    console.error('Failed to fetch workspaces:', err);
                }
            };
            fetchWorkspaces();
        }
    }, [user?.is_super_admin, apiUrl]);

    // Hanya Super Admin atau Owner yang bisa melihat konten card ini
    if (!user?.is_super_admin && !user?.is_owner) return null;

    // Helper to get effective workspace ID for API
    const getTargetId = (id: string) => {
        if (!user?.is_super_admin) return user?.workspace_id;
        if (id === 'all') return 'all';
        if (id === 'current') return user?.workspace_id;
        return id;
    };

    const handleExport = async () => {
        setExporting(true);
        setError('');
        setSuccess('');

        try {
            const token = getAuthToken();
            const targetId = getTargetId(exportId);
            const response = await fetch(`${apiUrl}/api/backup/export?targetWorkspaceId=${targetId}`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) throw new Error('Gagal mengunduh backup.');

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);

            let filename = `jnet-backup-${timestamp}.zip`;

            if (targetId === 'all') {
                filename = `jnet-all-ws-backup-${timestamp}.zip`;
            } else {
                const ws = workspaces.find(w => w.id.toString() === targetId?.toString());
                const cleanWsName = ws
                    ? ws.name.toLowerCase().trim().replace(/[^a-z0-9]/g, '-')
                    : `id-${targetId}`;
                filename = `jnet-ws-${cleanWsName}-backup-${timestamp}.zip`;
            }

            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);

            setSuccess('Backup berhasil diunduh.');
        } catch (err: any) {
            setError(err.message);
        } finally {
            setExporting(false);
        }
    };

    const handleRestoreClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const isNew = restoreId === 'new';
        const title = isNew ? 'Konfirmasi Restore (Workspace Baru)' : 'PERINGATAN KRITIS: Restore Data';
        const description = isNew
            ? 'Anda akan melakukan restore data ke WORKSPACE BARU. Workspace baru akan dibuat secara otomatis. Lanjutkan?'
            : 'Melakukan restore akan MENGHAPUS SEMUA DATA di workspace target saat ini dan menggantinya dengan data dari backup. Tindakan ini tidak dapat dibatalkan. Apakah Anda yakin ingin melanjutkan?';

        setPendingFile(file);
        setConfirmTitle(title);
        setConfirmDescription(description);
        setIsConfirmModalOpen(true);
    };

    const executeRestore = async () => {
        if (!pendingFile) return;

        setRestoring(true);
        setError('');
        setSuccess('');
        setIsConfirmModalOpen(false); // Close modal immediately, show loading in button

        const formData = new FormData();
        formData.append('backupFile', pendingFile);

        try {
            const token = getAuthToken();
            const targetId = getTargetId(restoreId);
            const res = await fetch(`${apiUrl}/api/backup/restore?targetWorkspaceId=${targetId}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                },
                body: formData
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Gagal melakukan restore.');

            setSuccess('Data berhasil di-restore! Halaman akan dimuat ulang dalam 3 detik...');
            setTimeout(() => {
                window.location.reload();
            }, 3000);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setRestoring(false);
            setPendingFile(null);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleCancelRestore = () => {
        setIsConfirmModalOpen(false);
        setPendingFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    return (
        <Card className="border-2 border-primary/20">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-primary">
                    <Database size={24} /> Backup & Restore Data
                </CardTitle>
                <CardDescription>
                    Pindahkan data server (Database, KML, dan Foto) ke server baru atau simpan untuk cadangan.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Export Section */}
                    <div className="p-4 rounded-lg bg-primary/5 border border-primary/10 flex flex-col justify-between">
                        <div>
                            <h3 className="font-semibold flex items-center gap-2 mb-2">
                                <Download size={18} className="text-primary" /> Export Data
                            </h3>
                            <p className="text-sm text-muted-foreground mb-4">
                                Unduh file ZIP berisi seluruh data aplikasi. Simpan file ini di tempat yang aman.
                            </p>

                            {/* Export Selection for Super Admin */}
                            {user?.is_super_admin && (
                                <div className="mb-4 space-y-2">
                                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pilih Sumber Data:</label>
                                    <select
                                        value={exportId}
                                        onChange={(e) => setExportId(e.target.value)}
                                        className="w-full text-sm border rounded-md p-2 bg-background text-foreground cursor-pointer"
                                    >
                                        <option value="current">Workspace Saya Saat Ini</option>
                                        <option value="all">Semua Workspace (Full Backup)</option>
                                        <optgroup label="Spesifik Workspace">
                                            {workspaces.map(ws => (
                                                <option key={ws.id} value={ws.id}>{ws.name} (ID: {ws.id})</option>
                                            ))}
                                        </optgroup>
                                    </select>
                                </div>
                            )}
                        </div>
                        <Button
                            onClick={handleExport}
                            disabled={exporting || restoring}
                            className="w-full"
                        >
                            {exporting ? <Loader2 className="mr-2 animate-spin" size={18} /> : <Download className="mr-2" size={18} />}
                            {exporting ? 'Sedang Menyiapkan...' : 'Unduh Backup (.zip)'}
                        </Button>
                    </div>

                    {/* Import Section */}
                    <div className="p-4 rounded-lg bg-destructive/5 border border-destructive/10 flex flex-col justify-between">
                        <div>
                            <h3 className="font-semibold flex items-center gap-2 mb-2 text-destructive">
                                <Upload size={18} /> Restore Data
                            </h3>
                            <p className="text-sm text-muted-foreground mb-4">
                                Unggah file ZIP backup untuk mengganti seluruh data server ini dengan data lama.
                            </p>

                            {/* Restore Selection for Super Admin */}
                            {user?.is_super_admin && (
                                <div className="mb-4 space-y-2">
                                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pilih Target Restore:</label>
                                    <select
                                        value={restoreId}
                                        onChange={(e) => setRestoreId(e.target.value)}
                                        className="w-full text-sm border rounded-md p-2 bg-background text-foreground cursor-pointer"
                                    >
                                        <option value="current">Workspace Saya Saat Ini</option>
                                        <option value="new">Restore sebagai Workspace Baru (Clone)</option>
                                        <optgroup label="Timpa Workspace Spesifik">
                                            {workspaces.map(ws => (
                                                <option key={ws.id} value={ws.id}>{ws.name} (ID: {ws.id})</option>
                                            ))}
                                        </optgroup>
                                        <option value="all">Full Server (Semua Data - Berbahaya)</option>
                                    </select>
                                </div>
                            )}
                        </div>
                        <input
                            type="file"
                            ref={fileInputRef}
                            onChange={handleFileChange}
                            accept=".zip"
                            className="hidden"
                        />
                        <Button
                            variant="destructive"
                            onClick={handleRestoreClick}
                            disabled={exporting || restoring}
                            className="w-full"
                        >
                            {restoring ? <Loader2 className="mr-2 animate-spin" size={18} /> : <Upload className="mr-2" size={18} />}
                            {restoring ? 'Sedang Restore...' : 'Restore dari ZIP'}
                        </Button>
                    </div>
                </div>

                {/* Warnings and Status */}
                <div className="space-y-3">
                    <div className="flex items-start gap-3 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md">
                        <AlertTriangle className="text-amber-600 shrink-0 mt-0.5" size={18} />
                        <div className="text-sm text-amber-800 dark:text-amber-200">
                            <strong>Perhatian:</strong> Backup ini menyertakan informasi akun, konfigurasi perangkat, dan data aset jaringan. Jangan membagikan file backup kepada pihak yang tidak berwenang.
                        </div>
                    </div>

                    {error && (
                        <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive rounded-md text-sm">
                            {error}
                        </div>
                    )}

                    {success && (
                        <div className="p-3 bg-green-500/10 border border-green-500/20 text-green-600 dark:text-green-400 rounded-md text-sm flex items-center gap-2">
                            <CheckCircle2 size={16} /> {success}
                        </div>
                    )}
                </div>
            </CardContent>


            <ConfirmModal
                isOpen={isConfirmModalOpen}
                onClose={handleCancelRestore}
                onConfirm={executeRestore}
                title={confirmTitle}
                description={confirmDescription}
                confirmText="Ya, Kembalikan Data"
                isLoading={restoring}
            />
        </Card >
    );
};

export default BackupRestoreCard;
