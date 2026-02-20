'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Bot, Loader2, Save, Send, QrCode as QrIcon } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import ConfirmModal from '@/components/ui/confirm-modal';
import { apiFetch } from '@/utils/api';
import { useAuth } from '../providers/auth-provider';
import { QRCodeSVG } from 'qrcode.react';

const WhatsappBotCard = () => {
    const { user } = useAuth();
    // Hanya Super Admin yang boleh mengubah status bot karena ini settingan global
    const isSuperAdmin = !!user?.is_super_admin;
    // Admin biasa boleh melihat status tapi tidak boleh mengubah
    const isAdmin = user?.role === 'admin';
    const [interfaces, setInterfaces] = useState<string[]>([]);
    const [selectedInterface, setSelectedInterface] = useState('');
    const [initialInterface, setInitialInterface] = useState('');
    const [whatsappGroupId, setWhatsappGroupId] = useState('');
    const [initialGroupId, setInitialGroupId] = useState('');
    const [availableGroups, setAvailableGroups] = useState<{ id: string, subject: string }[]>([]);
    const [fetchingGroups, setFetchingGroups] = useState(false);
    const [loading, setLoading] = useState(true);
    const [savingGroupId, setSavingGroupId] = useState(false);

    const [isConnected, setIsConnected] = useState(false);
    const [qrString, setQrString] = useState<string | null>(null);
    const [pollingQr, setPollingQr] = useState(false);

    // Global Management States (Super Admin Only)
    const [allWorkspaces, setAllWorkspaces] = useState<any[]>([]);
    const [fetchingAllWs, setFetchingAllWs] = useState(false);
    const [updatingWsId, setUpdatingWsId] = useState<number | null>(null);

    const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;

    const [testingWsId, setTestingWsId] = useState<string | number | null>(null);

    const handleSendTestMessage = async (jid: string, identifier: string | number) => {
        if (!jid) {
            toast.error("Pilih Tujuan", { description: "Silakan pilih grup atau masukkan ID WhatsApp terlebih dahulu." });
            return;
        }
        setTestingWsId(identifier);
        try {
            const res = await apiFetch(`${apiUrl}/api/bot/test-message`, {
                method: 'POST',
                body: JSON.stringify({ jid })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Gagal mengirim pesan tes');
            toast.success("Pesan Terkirim", { description: "Pesan tes berhasil dikirim! Silakan periksa grup/nomor tujuan." });
        } catch (error: any) {
            toast.error("Gagal Mengirim Pesan", { description: error.message });
        } finally {
            setTestingWsId(null);
        }
    };

    const fetchGroups = useCallback(async () => {
        setFetchingGroups(true);
        try {
            const res = await apiFetch(`${apiUrl}/api/bot/groups`);
            if (res.ok) {
                const data = await res.json();
                setAvailableGroups(data);
            }
        } catch (error) {
            console.error("Gagal ambil daftar grup:", error);
        } finally {
            setFetchingGroups(false);
        }
    }, [apiUrl]);

    // State untuk menampung pilihan grup tiap workspace (controlled)
    const [wsGroupSelections, setWsGroupSelections] = useState<Record<number, string>>({});

    const fetchAllWorkspaces = useCallback(async () => {
        if (!isSuperAdmin) return;
        setFetchingAllWs(true);
        try {
            const res = await apiFetch(`${apiUrl}/api/workspaces/all`);
            if (res.ok) {
                const data = await res.json();
                setAllWorkspaces(data);

                // Sinkronisasi state lokal dengan data dari database
                const selections: Record<number, string> = {};
                data.forEach((ws: any) => {
                    selections[ws.id] = ws.whatsapp_group_id || '';
                });
                setWsGroupSelections(selections);
            }
        } catch (error) {
            console.error("Gagal ambil daftar semua workspace:", error);
        } finally {
            setFetchingAllWs(false);
        }
    }, [apiUrl, isSuperAdmin]);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const workspaceRes = await apiFetch(`${apiUrl}/api/workspaces/me`);
            const workspaceData = await workspaceRes.json();

            // Set WhatsApp Group ID
            setWhatsappGroupId(workspaceData.whatsapp_group_id || '');
            setInitialGroupId(workspaceData.whatsapp_group_id || '');

            // Coba ambil daftar grup
            fetchGroups();

            // Jika super admin, ambil semua workspace
            if (isSuperAdmin) {
                fetchAllWorkspaces();
            }

        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    }, [apiUrl, fetchGroups, isSuperAdmin, fetchAllWorkspaces]);

    const fetchQrStatus = useCallback(async () => {
        try {
            const res = await apiFetch(`${apiUrl}/api/bot/qr`);
            if (res.ok) {
                const data = await res.json();
                setIsConnected(data.connected);
                setQrString(data.qr);
            }
        } catch (error) {
            console.error("Gagal ambil status QR:", error);
        }
    }, [apiUrl]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // Polling untuk status QR (Always On)
    useEffect(() => {
        fetchQrStatus(); // initial call
        const interval = setInterval(fetchQrStatus, 5000);
        return () => clearInterval(interval);
    }, [fetchQrStatus]);

    // Jika status koneksi berubah jadi connected, refresh grup
    useEffect(() => {
        if (isConnected) {
            fetchGroups();
        }
    }, [isConnected, fetchGroups]);



    const handleSaveGroupId = async () => {
        setSavingGroupId(true);
        try {
            const res = await apiFetch(`${apiUrl}/api/workspaces/whatsapp-group-id`, {
                method: 'PUT',
                body: JSON.stringify({ whatsapp_group_id: whatsappGroupId.trim() || null })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Gagal menyimpan WhatsApp Group ID');
            setInitialGroupId(whatsappGroupId.trim());
            alert('WhatsApp Group ID berhasil disimpan!');

            // Refresh global list if super admin
            if (isSuperAdmin) fetchAllWorkspaces();
        } catch (error: any) {
            alert(`Gagal menyimpan WhatsApp Group ID: ${error.message}`);
        } finally {
            setSavingGroupId(false);
        }
    };

    const handleAdminSaveGroupId = async (workspaceId: number, groupId: string) => {
        setUpdatingWsId(workspaceId);
        try {
            const res = await apiFetch(`${apiUrl}/api/workspaces/${workspaceId}/whatsapp-group-id`, {
                method: 'PUT',
                body: JSON.stringify({ whatsapp_group_id: groupId.trim() || null })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Gagal memperbarui WhatsApp Group ID');
            toast.success("Berhasil Diperbarui", { description: "WhatsApp Group ID untuk workspace berhasil diperbarui!" });

            // Update local selection state
            setWsGroupSelections(prev => ({ ...prev, [workspaceId]: groupId.trim() }));

            fetchAllWorkspaces();
        } catch (error: any) {
            toast.error("Gagal Memperbarui", { description: error.message });
        } finally {
            setUpdatingWsId(null);
        }
    };

    const [resetting, setResetting] = useState(false);
    const [otpRequired, setOtpRequired] = useState(false);
    const [otp, setOtp] = useState('');
    const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);

    const handleResetClick = () => {
        if (!otpRequired) {
            setIsResetConfirmOpen(true);
        } else {
            handleResetSession();
        }
    };

    const handleResetSession = async () => {
        setIsResetConfirmOpen(false);
        setResetting(true);
        try {
            // Jika belum minta OTP, minta dulu
            if (!otpRequired) {
                const reqRes = await apiFetch(`${apiUrl}/api/bot/request-reset`, {
                    method: 'POST',
                });
                const reqData = await reqRes.json();

                if (!reqRes.ok) throw new Error(reqData.message);

                if (reqData.otpRequired) {
                    setOtpRequired(true);
                    toast.info("OTP Diperlukan", { description: reqData.message });
                    setResetting(false);
                    return;
                }
                // Jika tidak butuh OTP, lanjut ke reset
            }

            // Eksekusi reset (dengan atau tanpa OTP)
            const res = await apiFetch(`${apiUrl}/api/bot/reset-session`, {
                method: 'POST',
                body: JSON.stringify({ otp: otpRequired ? otp : null })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message);

            toast.success("Sesi Direset", { description: data.message });
            setOtpRequired(false);
            setOtp('');

            setTimeout(() => {
                window.location.reload();
            }, 3000);
        } catch (error: any) {
            toast.error("Gagal Reset Sesi", { description: error.message });
        } finally {
            setResetting(false);
        }
    };

    if (loading) {
        return <Card><CardContent className="p-6 flex justify-center"><Loader2 className="animate-spin" /></CardContent></Card>;
    }

    return (
        <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Bot /> Layanan WhatsApp Gateway</CardTitle></CardHeader>
            <CardContent className="space-y-6">
                <div className="bg-primary/5 p-4 rounded-xl border border-primary/20">
                    <p className="text-sm text-primary font-medium">WhatsApp Gateway aktif otomatis untuk mengirimkan OTP dan notifikasi downtime/reconnect ke nomor atau grup yang Anda tentukan di bawah.</p>
                </div>

                {/* QR Section */}
                {!isConnected && (
                    <div className="pt-6 border-t flex flex-col items-center gap-4 animate-in fade-in zoom-in-95 duration-500">
                        <div className="text-center">
                            <h3 className="text-lg font-bold flex items-center justify-center gap-2">
                                <QrIcon className="text-primary" /> Hubungkan WhatsApp
                            </h3>
                            <p className="text-sm text-muted-foreground mt-1">Silakan pindai kode QR di bawah ini dengan WhatsApp di HP Anda untuk mengaktifkan layanan.</p>
                        </div>

                        <div className="bg-white p-6 rounded-2xl shadow-inner border border-border/50">
                            {qrString ? (
                                <div className="relative group">
                                    <QRCodeSVG
                                        value={qrString}
                                        size={220}
                                        level="H"
                                        includeMargin={false}
                                    />
                                    <div className="absolute inset-0 bg-white/5 backdrop-blur-[1px] opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                                </div>
                            ) : (
                                <div className="w-[220px] h-[220px] flex flex-col items-center justify-center gap-3 text-muted-foreground">
                                    <Loader2 className="animate-spin text-primary" size={40} />
                                    <p className="text-xs font-medium animate-pulse text-primary/70 uppercase tracking-widest">Menyiapkan QR Code...</p>
                                </div>
                            )}
                        </div>

                        <div className="flex gap-2 items-center text-[10px] text-muted-foreground">
                            <span className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
                            <span>Menunggu pemindaian... (Update otomatis tiap 5 detik)</span>
                        </div>
                    </div>
                )}

                {/* Status Ringkasan */}
                <div className="pt-6 border-t">
                    <div className="flex justify-between items-center mb-4">
                        <div className="flex items-center gap-3">
                            <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]' : 'bg-yellow-500 animate-pulse'}`} />
                            <span className="text-sm font-semibold tracking-wide uppercase">
                                Status Koneksi: {isConnected ? 'Terhubung (Ready)' : 'Menunggu Koneksi...'}
                            </span>
                        </div>
                    </div>
                </div>

                {isSuperAdmin && allWorkspaces.length > 0 && (
                    <div className="pt-6 border-t animate-in fade-in slide-in-from-bottom-2">
                        <div className="flex items-center justify-between mb-4">
                            <h4 className="text-sm font-semibold flex items-center gap-2">
                                <Bot size={16} className="text-primary" /> Manajemen WhatsApp Per Workspace
                            </h4>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={fetchAllWorkspaces}
                                disabled={fetchingAllWs}
                                className="h-8 text-[10px] uppercase tracking-wider"
                            >
                                {fetchingAllWs ? <Loader2 size={12} className="mr-2 animate-spin" /> : null}
                                Refresh List
                            </Button>
                        </div>
                        <div className="grid gap-3">
                            {allWorkspaces.map(ws => (
                                <div key={ws.id} className="group flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-xl border bg-secondary/10 hover:bg-secondary/20 transition-colors">
                                    <div className="space-y-0.5">
                                        <div className="flex items-center gap-2">
                                            <p className="font-bold text-sm">{ws.name}</p>
                                            {ws.id === user?.workspace_id && <span className="text-[9px] bg-primary/20 text-primary px-1.5 py-0.5 rounded-full font-bold uppercase">Milik Anda</span>}
                                        </div>
                                        <p className="text-[10px] text-muted-foreground font-medium opacity-70">
                                            Workspace ID: {ws.id}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <select
                                            value={wsGroupSelections[ws.id] || ''}
                                            onChange={(e) => {
                                                const val = e.target.value;
                                                setWsGroupSelections(prev => ({ ...prev, [ws.id]: val }));
                                            }}
                                            className="flex-1 sm:w-64 text-xs p-2 rounded-lg border bg-background focus:ring-2 focus:ring-primary/30 outline-none transition-shadow"
                                            id={`ws-input-${ws.id}`}
                                            disabled={fetchingGroups || availableGroups.length === 0}
                                        >
                                            <option value="">-- Tanpa Grup --</option>
                                            {availableGroups.map(group => (
                                                <option key={group.id} value={group.id}>{group.subject}</option>
                                            ))}
                                            {wsGroupSelections[ws.id] && !availableGroups.find(g => g.id === wsGroupSelections[ws.id]) && (
                                                <option value={wsGroupSelections[ws.id]}>{wsGroupSelections[ws.id]} (Grup Tersimpan)</option>
                                            )}
                                        </select>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="h-9 px-3"
                                            title="Kirim pesan tes ke grup ini"
                                            disabled={testingWsId === `test-${ws.id}`}
                                            onClick={() => handleSendTestMessage(wsGroupSelections[ws.id], `test-${ws.id}`)}
                                        >
                                            {testingWsId === `test-${ws.id}` ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                                        </Button>
                                        <Button
                                            variant="default"
                                            size="sm"
                                            className="h-9 px-3"
                                            disabled={updatingWsId === ws.id}
                                            onClick={() => {
                                                handleAdminSaveGroupId(ws.id, wsGroupSelections[ws.id]);
                                            }}
                                        >
                                            {updatingWsId === ws.id ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <div className="pt-6 border-t">
                    <div className="space-y-2">
                        <label className="block text-sm font-medium">WhatsApp Group ID</label>
                        <div className="flex items-center gap-4">
                            <select
                                className="w-full p-2 rounded-md bg-input border-border font-mono text-sm"
                                value={whatsappGroupId}
                                onChange={(e) => setWhatsappGroupId(e.target.value)}
                                disabled={fetchingGroups || availableGroups.length === 0}
                            >
                                <option value="">-- Pilih Group WhatsApp --</option>
                                {availableGroups.map(group => (
                                    <option key={group.id} value={group.id}>{group.subject}</option>
                                ))}
                                {whatsappGroupId && !availableGroups.find(g => g.id === whatsappGroupId) && (
                                    <option value={whatsappGroupId}>{whatsappGroupId} (Manual)</option>
                                )}
                            </select>
                            <Button
                                onClick={fetchGroups}
                                variant="outline"
                                size="sm"
                                disabled={fetchingGroups}
                                title="Refresh daftar grup"
                            >
                                {fetchingGroups ? <Loader2 size={16} className="animate-spin" /> : <Bot size={16} />}
                            </Button>
                            <Button
                                onClick={() => handleSendTestMessage(whatsappGroupId, 'current-ws-test')}
                                variant="outline"
                                size="sm"
                                disabled={testingWsId === 'current-ws-test'}
                                title="Kirim pesan tes ke grup pilihan"
                            >
                                {testingWsId === 'current-ws-test' ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                            </Button>
                            <Button
                                onClick={handleSaveGroupId}
                                disabled={savingGroupId || whatsappGroupId === initialGroupId}
                            >
                                {savingGroupId ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save size={16} className="mr-2" />}
                                Simpan
                            </Button>
                        </div>
                        {availableGroups.length === 0 && !fetchingGroups && (
                            <p className="text-[10px] text-muted-foreground italic">Bot terhubung tapi tidak menemukan grup pendengar, atau Anda belum masuk ke grup apapun.</p>
                        )}
                        {initialGroupId && (
                            <p className="text-xs text-muted-foreground">
                                Grup saat ini: <code className="bg-secondary px-1 py-0.5 rounded">
                                    {availableGroups.find(g => g.id === initialGroupId)?.subject || initialGroupId}
                                </code>
                            </p>
                        )}
                    </div>
                </div>

                {isSuperAdmin && (
                    <div className="pt-6 border-t">
                        <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4">
                            <h4 className="text-sm font-semibold text-destructive mb-1">Ganti Nomor / Reset Sesi</h4>
                            <p className="text-xs text-muted-foreground mb-4">
                                Gunakan ini jika Anda ingin mengganti akun WhatsApp atau jika bot mengalami masalah koneksi. Sesi akan dihapus dan aplikasi akan restart.
                            </p>

                            {otpRequired && (
                                <div className="mb-4 animate-in fade-in slide-in-from-top-2">
                                    <label className="block text-xs font-bold text-destructive mb-1 uppercase tracking-wider">Masukkan Kode OTP WA</label>
                                    <input
                                        type="text"
                                        maxLength={6}
                                        placeholder="000000"
                                        value={otp}
                                        onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                                        className="w-full max-w-[150px] p-2 mb-2 rounded border border-destructive/30 bg-background text-center font-mono text-lg tracking-widest focus:outline-none focus:ring-2 focus:ring-destructive/50"
                                    />
                                    <p className="text-[10px] text-muted-foreground italic">Kode telah dikirim ke WhatsApp Admin.</p>
                                </div>
                            )}

                            <div className="flex gap-2">
                                <Button
                                    variant="destructive"
                                    size="sm"
                                    onClick={handleResetClick}
                                    disabled={resetting || (otpRequired && otp.length < 6)}
                                >
                                    {resetting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                    {otpRequired ? 'Konfirmasi & Reset' : 'Reset Sesi WhatsApp'}
                                </Button>

                                {otpRequired && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => { setOtpRequired(false); setOtp(''); }}
                                        className="text-muted-foreground"
                                    >
                                        Batal
                                    </Button>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </CardContent>

            <ConfirmModal
                isOpen={isResetConfirmOpen}
                onClose={() => setIsResetConfirmOpen(false)}
                onConfirm={handleResetSession}
                title="Reset Sesi WhatsApp"
                description="Tindakan ini akan MENGHAPUS SEMUA data login WhatsApp Bot dan me-restart sistem. Anda harus scan QR code lagi setelah ini. Lanjutkan?"
                confirmText="Ya, Reset Sesi"
                isLoading={resetting}
            />
        </Card>
    );
};
export default WhatsappBotCard;