'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Key, Loader2, Plus, Trash2, Copy, Check } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { apiFetch } from '@/utils/api';
import { useAuth } from '../providers/auth-provider';
import ConfirmModal from '@/components/ui/confirm-modal';

interface ApiKey {
    id: number;
    workspace_id: number;
    workspace_name: string;
    name: string;
    key_string: string;
    created_at: string;
}

const ApiKeyManagementCard = () => {
    const { user } = useAuth();
    const isSuperAdmin = !!user?.is_super_admin;

    const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
    const [loading, setLoading] = useState(true);
    const [workspaces, setWorkspaces] = useState<{ id: number, name: string }[]>([]);

    // Form state
    const [isCreating, setIsCreating] = useState(false);
    const [newKeyName, setNewKeyName] = useState('');
    const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('');

    // Delete state
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [keyToDelete, setKeyToDelete] = useState<number | null>(null);
    const [deleting, setDeleting] = useState(false);

    // Generated Key Modal State
    const [isGeneratedModalOpen, setIsGeneratedModalOpen] = useState(false);
    const [generatedKey, setGeneratedKey] = useState('');
    const [hasCopied, setHasCopied] = useState(false);

    const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;

    const fetchData = useCallback(async () => {
        if (!isSuperAdmin) {
            setLoading(false);
            return;
        }

        try {
            // Fetch API Keys
            const keysRes = await apiFetch(`${apiUrl}/api/api-keys`);
            if (keysRes.ok) {
                const keysData = await keysRes.json();
                setApiKeys(keysData);
            }

            // Fetch Workspaces for dropdown
            const wsRes = await apiFetch(`${apiUrl}/api/workspaces/all`);
            if (wsRes.ok) {
                const wsData = await wsRes.json();
                setWorkspaces(wsData);
            }
        } catch (error: any) {
            toast.error("Gagal Mengambil Data", { description: error.message });
        } finally {
            setLoading(false);
        }
    }, [apiUrl, isSuperAdmin]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleCreateKey = async () => {
        if (!newKeyName.trim() || !selectedWorkspaceId) {
            toast.error("Validasi Gagal", { description: "Nama API Key dan Workspace harus diisi." });
            return;
        }

        setIsCreating(true);
        try {
            const res = await apiFetch(`${apiUrl}/api/api-keys`, {
                method: 'POST',
                body: JSON.stringify({
                    name: newKeyName.trim(),
                    workspace_id: parseInt(selectedWorkspaceId)
                })
            });
            const data = await res.json();

            if (!res.ok) throw new Error(data.message || 'Gagal membuat API Key');

            toast.success("API Key Dibuat", { description: "Simpan API Key ini, karena tidak akan ditampilkan lagi." });
            setNewKeyName('');
            setSelectedWorkspaceId('');

            // Show the newly generated key in a modal instead of alert
            setGeneratedKey(data.apiKey.key_string);
            setIsGeneratedModalOpen(true);
            setHasCopied(false);

            fetchData();
        } catch (error: any) {
            toast.error("Gagal", { description: error.message });
        } finally {
            setIsCreating(false);
        }
    };

    const confirmDelete = (id: number) => {
        setKeyToDelete(id);
        setIsDeleteModalOpen(true);
    };

    const handleDeleteKey = async () => {
        if (!keyToDelete) return;
        setDeleting(true);
        try {
            const res = await apiFetch(`${apiUrl}/api/api-keys/${keyToDelete}`, {
                method: 'DELETE'
            });
            const data = await res.json();

            if (!res.ok) throw new Error(data.message || 'Gagal menghapus API Key');

            toast.success("Berhasil", { description: "API Key telah dihapus." });
            fetchData();
        } catch (error: any) {
            toast.error("Gagal Menghapus", { description: error.message });
        } finally {
            setDeleting(false);
            setIsDeleteModalOpen(false);
            setKeyToDelete(null);
        }
    };

    const copyToClipboard = () => {
        if (!generatedKey) return;
        navigator.clipboard.writeText(generatedKey).then(() => {
            setHasCopied(true);
            toast.success("Disalin", { description: "API Key berhasil disalin ke clipboard." });
            setTimeout(() => setHasCopied(false), 2000);
        }).catch(() => {
            toast.error("Gagal", { description: "Gagal menyalin ke clipboard." });
        });
    };

    if (!isSuperAdmin) return null;

    if (loading) {
        return <Card><CardContent className="p-6 flex justify-center"><Loader2 className="animate-spin text-primary" /></CardContent></Card>;
    }

    return (
        <Card className="border-primary/20 shadow-sm">
            <CardHeader className="bg-primary/5 pb-4 border-b">
                <CardTitle className="flex items-center gap-2 text-primary">
                    <Key size={20} /> Manajemen API Key (Service Accounts)
                </CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                    Kelola akses API eksternal seperti integrasi agen AI OpenClaw. API Key hanya ditampilkan saat pertama kali dibuat.
                </p>
            </CardHeader>
            <CardContent className="space-y-6 pt-6">
                {/* Buat API Key Baru */}
                <div className="bg-secondary/20 p-4 rounded-xl border border-border/50">
                    <h4 className="text-sm font-semibold mb-3">Buat API Key Baru</h4>
                    <div className="flex flex-col sm:flex-row gap-3">
                        <select
                            className="p-2 rounded-md border bg-background text-sm flex-1 sm:max-w-[200px]"
                            value={selectedWorkspaceId}
                            onChange={(e) => setSelectedWorkspaceId(e.target.value)}
                            disabled={isCreating}
                        >
                            <option value="">-- Pilih Workspace --</option>
                            {workspaces.map(ws => (
                                <option key={ws.id} value={ws.id}>{ws.name}</option>
                            ))}
                        </select>
                        <input
                            type="text"
                            placeholder="Nama / Identifier (misal: OpenClaw PC Utama)"
                            className="p-2 rounded-md border bg-background text-sm flex-1"
                            value={newKeyName}
                            onChange={(e) => setNewKeyName(e.target.value)}
                            disabled={isCreating}
                        />
                        <Button
                            onClick={handleCreateKey}
                            disabled={isCreating || !newKeyName.trim() || !selectedWorkspaceId}
                        >
                            {isCreating ? <Loader2 size={16} className="animate-spin mr-2" /> : <Plus size={16} className="mr-2" />}
                            Generate Key
                        </Button>
                    </div>
                </div>

                {/* Daftar API Key */}
                <div className="rounded-xl border border-border overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-muted text-muted-foreground text-xs uppercase">
                                <tr>
                                    <th className="px-4 py-3 font-medium">Workspace</th>
                                    <th className="px-4 py-3 font-medium">Nama</th>
                                    <th className="px-4 py-3 font-medium">Key (Masked)</th>
                                    <th className="px-4 py-3 font-medium cursor-pointer" title="Dibuat Pada">Tgl Dibuat</th>
                                    <th className="px-4 py-3 font-medium text-right">Aksi</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {apiKeys.length > 0 ? (
                                    apiKeys.map(key => (
                                        <tr key={key.id} className="hover:bg-muted/50 transition-colors">
                                            <td className="px-4 py-3">
                                                <div className="font-medium">{key.workspace_name || 'Terhapus'}</div>
                                                <div className="text-[10px] text-muted-foreground">ID: {key.workspace_id}</div>
                                            </td>
                                            <td className="px-4 py-3 font-medium">{key.name}</td>
                                            <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                                                {key.key_string.substring(0, 8)}...{key.key_string.substring(key.key_string.length - 4)}
                                            </td>
                                            <td className="px-4 py-3 text-xs text-muted-foreground">
                                                {new Date(key.created_at).toLocaleDateString('id-ID')}
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="text-destructive hover:bg-destructive/10 hover:text-destructive h-8 px-2"
                                                    onClick={() => confirmDelete(key.id)}
                                                    title="Hapus API Key"
                                                >
                                                    <Trash2 size={16} />
                                                </Button>
                                            </td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr>
                                        <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground italic text-sm">
                                            Belum ada API Key yang tersimpan di sistem.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </CardContent>

            <ConfirmModal
                isOpen={isDeleteModalOpen}
                onClose={() => setIsDeleteModalOpen(false)}
                onConfirm={handleDeleteKey}
                title="Hapus API Key"
                description="Tindakan ini permanen. Aplikasi atau integrasi yang menggunakan API Key ini akan kehilangan akses. Lanjutkan?"
                confirmText="Ya, Hapus"
                isLoading={deleting}
            />

            {/* Modal untuk API Key Baru */}
            {isGeneratedModalOpen && (
                <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                    <Card className="w-full max-w-md shadow-lg animate-in fade-in zoom-in-95">
                        <CardHeader className="border-b bg-primary/5 pb-4 text-center">
                            <div className="mx-auto bg-green-100 text-green-600 p-3 rounded-full w-fit mb-3">
                                <Key size={24} />
                            </div>
                            <CardTitle className="text-xl">API Key Berhasil Dibuat!</CardTitle>
                        </CardHeader>
                        <CardContent className="pt-6 space-y-4">
                            <div className="bg-destructive/10 border border-destructive/20 p-3 flex rounded-xl items-start gap-2 text-destructive">
                                <span className="text-xl">⚠️</span>
                                <p className="text-sm font-medium leading-relaxed">
                                    Simpan kunci ini <b>sekarang</b>! Untuk tujuan keamanan, API Key ini tidak akan pernah ditampilkan lagi setelah Anda menutup jendela ini.
                                </p>
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-semibold">API Key Anda:</label>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="text"
                                        readOnly
                                        value={generatedKey}
                                        className="flex-1 p-3 rounded-md bg-secondary border border-border font-mono text-sm focus:outline-none"
                                        onClick={(e) => (e.target as HTMLInputElement).select()}
                                    />
                                    <Button
                                        variant="default"
                                        className="shrink-0"
                                        onClick={copyToClipboard}
                                    >
                                        {hasCopied ? <Check size={18} className="text-green-400" /> : <Copy size={18} />}
                                    </Button>
                                </div>
                            </div>

                            <div className="pt-4 flex justify-end">
                                <Button
                                    variant="outline"
                                    className="w-full"
                                    onClick={() => {
                                        setIsGeneratedModalOpen(false);
                                        setGeneratedKey('');
                                    }}
                                >
                                    Saya sudah menyimpannya, Tutup
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}
        </Card>
    );
};

export default ApiKeyManagementCard;
