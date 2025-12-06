'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Bot, Loader2, Save, Send } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/utils/api';

const WhatsappBotCard = () => {
    const [isEnabled, setIsEnabled] = useState(false);
    const [interfaces, setInterfaces] = useState<string[]>([]);
    const [selectedInterface, setSelectedInterface] = useState('');
    const [initialInterface, setInitialInterface] = useState('');
    const [whatsappGroupId, setWhatsappGroupId] = useState('');
    const [initialGroupId, setInitialGroupId] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [savingGroupId, setSavingGroupId] = useState(false);
    const [testing, setTesting] = useState(false);
    const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const [workspaceRes, interfacesRes] = await Promise.all([
                apiFetch(`${apiUrl}/api/workspaces/me`),
                apiFetch(`${apiUrl}/api/workspaces/interfaces`)
            ]);

            const workspaceData = await workspaceRes.json();
            const interfacesData = await interfacesRes.json();

            setIsEnabled(workspaceData.whatsapp_bot_enabled);
            setInterfaces(interfacesData);
            
            if (workspaceData.main_interface) {
                setSelectedInterface(workspaceData.main_interface);
                setInitialInterface(workspaceData.main_interface);
            } else if (interfacesData.length > 0) {
                setSelectedInterface(interfacesData[0]);
            }
            
            // Set WhatsApp Group ID
            setWhatsappGroupId(workspaceData.whatsapp_group_id || '');
            setInitialGroupId(workspaceData.whatsapp_group_id || '');

        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleToggle = async (checked: boolean) => {
        setIsEnabled(checked);
        try {
            await apiFetch(`${apiUrl}/api/bot/toggle`, {
                method: 'POST',
                body: JSON.stringify({ isEnabled: checked })
            });
        } catch (error) {
            alert("Gagal mengubah status bot.");
            setIsEnabled(!checked);
        }
    };

    const handleSaveInterface = async () => {
        setSaving(true);
        try {
            await apiFetch(`${apiUrl}/api/workspaces/set-main-interface`, {
                method: 'PUT',
                body: JSON.stringify({ interfaceName: selectedInterface })
            });
            setInitialInterface(selectedInterface);
            alert('Interface utama berhasil disimpan!');
        } catch (error) {
            alert('Gagal menyimpan interface.');
        } finally {
            setSaving(false);
        }
    };
    
    const handleSendTest = async () => {
        setTesting(true);
        try {
            const res = await apiFetch(`${apiUrl}/api/bot/test-report`, {
                method: 'POST',
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message);
            alert(data.message);
        } catch (error: any) {
            alert(`Gagal mengirim tes: ${error.message}`);
        } finally {
            setTesting(false);
        }
    };
    
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
        } catch (error: any) {
            alert(`Gagal menyimpan WhatsApp Group ID: ${error.message}`);
        } finally {
            setSavingGroupId(false);
        }
    };

    if (loading) {
        return <Card><CardContent className="p-6 flex justify-center"><Loader2 className="animate-spin"/></CardContent></Card>;
    }

    return (
        <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Bot /> Bot WhatsApp Interaktif</CardTitle></CardHeader>
            <CardContent className="space-y-6">
                <div className="flex items-center justify-between">
                    <p className="text-sm text-muted-foreground pr-4">Aktifkan bot untuk menerima notifikasi dan menjalankan perintah via WhatsApp.</p>
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" className="sr-only peer" checked={isEnabled} onChange={(e) => handleToggle(e.target.checked)} />
                        <div className="w-11 h-6 bg-secondary rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                    </label>
                </div>
                
                <div className="pt-6 border-t">
                    <div className="flex justify-between items-center">
                        <label className="block text-sm font-medium">Interface Utama untuk Laporan Trafik</label>
                        <Button variant="ghost" size="sm" onClick={handleSendTest} disabled={testing || !isEnabled}>
                            {testing ? <Loader2 size={16} className="animate-spin mr-2"/> : <Send size={16} className="mr-2"/>}
                            Tes Laporan
                        </Button>
                    </div>
                    <div className="flex items-center gap-4 mt-2">
                        <select 
                            className="w-full p-2 rounded-md bg-input border-border"
                            value={selectedInterface}
                            onChange={(e) => setSelectedInterface(e.target.value)}
                            disabled={interfaces.length === 0}
                        >
                            {interfaces.length > 0 ? (
                                interfaces.map(iface => <option key={iface} value={iface}>{iface}</option>)
                            ) : (
                                <option>Tidak ada perangkat aktif</option>
                            )}
                        </select>
                        <Button onClick={handleSaveInterface} disabled={saving || selectedInterface === initialInterface}>
                            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save size={16} className="mr-2"/>}
                            Simpan
                        </Button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">Pilih antarmuka (ethernet/wlan) yang menuju ke internet untuk pencatatan trafik yang akurat.</p>
                </div>
                
                <div className="pt-6 border-t">
                    <div className="space-y-2">
                        <label className="block text-sm font-medium">WhatsApp Group ID</label>
                        <p className="text-xs text-muted-foreground">
                            Untuk mendapatkan Group ID, kirim pesan <code className="bg-secondary px-1 py-0.5 rounded">.getgroupid</code> di group WhatsApp Anda.
                        </p>
                        <div className="flex items-center gap-4">
                            <input
                                type="text"
                                placeholder="120363424303016733@g.us"
                                value={whatsappGroupId}
                                onChange={(e) => setWhatsappGroupId(e.target.value)}
                                className="w-full p-2 rounded-md bg-input border-border font-mono text-sm"
                            />
                            <Button 
                                onClick={handleSaveGroupId} 
                                disabled={savingGroupId || whatsappGroupId.trim() === initialGroupId}
                            >
                                {savingGroupId ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save size={16} className="mr-2"/>}
                                Simpan
                            </Button>
                        </div>
                        {whatsappGroupId && !whatsappGroupId.endsWith('@g.us') && (
                            <p className="text-xs text-destructive">Format tidak valid. Group ID harus berakhiran @g.us</p>
                        )}
                        {initialGroupId && (
                            <p className="text-xs text-muted-foreground">
                                Group ID saat ini: <code className="bg-secondary px-1 py-0.5 rounded">{initialGroupId}</code>
                            </p>
                        )}
                    </div>
                </div>
            </CardContent>
        </Card>
    );
};
export default WhatsappBotCard;