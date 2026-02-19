'use client';

import React, { useState, useRef } from 'react';
import { Database, Download, Upload, AlertTriangle, Loader2, CheckCircle2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { apiFetch, getAuthToken } from '@/utils/api';
import { useAuth } from '@/components/providers/auth-provider';

const BackupRestoreCard = () => {
    const { user } = useAuth();
    const [exporting, setExporting] = useState(false);
    const [restoring, setRestoring] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;

    // Hanya Super Admin yang bisa melihat konten card ini
    if (!user?.is_super_admin) return null;

    const handleExport = async () => {
        setExporting(true);
        setError('');
        setSuccess('');

        try {
            const token = getAuthToken();
            const response = await fetch(`${apiUrl}/api/backup/export`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) throw new Error('Gagal mengunduh backup.');

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
            a.href = url;
            a.download = `jnet-backup-${timestamp}.zip`;
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

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!confirm('PERINGATAN KRITIS: Melakukan restore akan MENGHAPUS SEMUA DATA saat ini dan menggantinya dengan data dari backup. Apakah Anda yakin ingin melanjutkan?')) {
            if (fileInputRef.current) fileInputRef.current.value = '';
            return;
        }

        setRestoring(true);
        setError('');
        setSuccess('');

        const formData = new FormData();
        formData.append('backupFile', file);

        try {
            const token = getAuthToken();
            const res = await fetch(`${apiUrl}/api/backup/restore`, {
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
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    return (
        <Card className="border-2 border-primary/20">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-primary">
                    <Database size={24} /> Backup & Restore Data
                </CardTitle>
                <CardDescription>
                    Pindahkan seluruh data server (Database, KML, dan Avatar) ke server baru atau simpan untuk cadangan.
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
        </Card>
    );
};

export default BackupRestoreCard;
