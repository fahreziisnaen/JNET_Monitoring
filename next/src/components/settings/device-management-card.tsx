'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Server, Plus, Edit, Trash2, CheckCircle, Loader2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import DeviceModal, { Device } from './device-modal';
import ConfirmModal from '../ui/confirm-modal';
import { useAuth } from '../providers/auth-provider';
import { useMikrotik } from '../providers/mikrotik-provider';
import { apiFetch } from '@/utils/api';
import { toast } from 'sonner';

const DeviceManagementCard = () => {
    const { user } = useAuth();
    const { allDevicesStatus } = useMikrotik() || {};
    // Samakan dengan authorizeAdmin di backend: admin, owner, atau Super Admin
    const isAdmin = user?.role === 'admin' || user?.is_owner || user?.is_super_admin;
    const [devices, setDevices] = useState<Device[]>([]);
    const [activeDeviceId, setActiveDeviceId] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [isActionLoading, setIsActionLoading] = useState(false);

    const [isDeviceModalOpen, setIsDeviceModalOpen] = useState(false);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [deviceToProcess, setDeviceToProcess] = useState<Device | null>(null);
    const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;

    const fetchData = useCallback(async () => {
        if (!user?.workspace_id) return;
        setLoading(true);
        try {
            const [devicesRes, workspaceRes] = await Promise.all([
                // Batasi ke workspace aktif; tanpa ini Super Admin menerima perangkat semua workspace
                apiFetch(`${apiUrl}/api/devices?workspaceId=${user.workspace_id}`),
                apiFetch(`${apiUrl}/api/workspaces/me`)
            ]);

            if (!devicesRes.ok || !workspaceRes.ok) {
                throw new Error('Gagal memuat data perangkat atau workspace.');
            }

            const devicesData = await devicesRes.json();
            const workspaceData = await workspaceRes.json();

            setDevices(devicesData);
            setActiveDeviceId(workspaceData.active_device_id);

        } catch (error) {
            console.error("Fetch error:", error);
        } finally {
            setLoading(false);
        }
    }, [user, apiUrl]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleSuccess = () => {
        fetchData();
    };

    const handleAddClick = () => {
        setDeviceToProcess(null);
        setIsDeviceModalOpen(true);
    };

    const handleEditClick = (device: Device) => {
        setDeviceToProcess(device);
        setIsDeviceModalOpen(true);
    };

    const handleDeleteClick = (device: Device) => {
        setDeviceToProcess(device);
        setIsDeleteModalOpen(true);
    };

    const handleDeleteConfirm = async () => {
        if (!deviceToProcess?.id) return;
        setIsActionLoading(true);
        try {
            const res = await apiFetch(`${apiUrl}/api/devices/${deviceToProcess.id}`, {
                method: 'DELETE'
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.message || 'Gagal menghapus perangkat.');
            toast.success('Perangkat Dihapus', { description: data.message });
            handleSuccess();
        } catch (error: any) {
            console.error("Gagal menghapus perangkat:", error);
            toast.error('Gagal Menghapus Perangkat', { description: error.message });
        } finally {
            setIsActionLoading(false);
            setIsDeleteModalOpen(false);
            setDeviceToProcess(null);
        }
    };

    const handleSetActive = async (deviceId: number) => {
        setIsActionLoading(true);
        try {
            await apiFetch(`${apiUrl}/api/workspaces/set-active-device`, {
                method: 'POST',
                body: JSON.stringify({ deviceId })
            });
            handleSuccess();
        } catch (error) {
            console.error("Gagal set perangkat aktif:", error);
        } finally {
            setIsActionLoading(false);
        }
    }

    return (
        <>
            <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                        <CardTitle>Manajemen Perangkat</CardTitle>
                        <p className="text-xs text-muted-foreground mt-1">Semua perangkat dipantau secara otomatis di latar belakang.</p>
                    </div>
                    {isAdmin && (
                        <Button onClick={handleAddClick}>
                            <Plus size={16} className="mr-2" />
                            Tambah
                        </Button>
                    )}
                </CardHeader>
                <CardContent className="space-y-3">
                    {loading ? (
                        <div className="flex justify-center p-4"><Loader2 className="animate-spin" /></div>
                    ) : devices.length > 0 ? (
                        devices.map(device => {
                            const deviceStatus = allDevicesStatus?.[device.id!] || { isConnected: false };
                            const isOnline = deviceStatus.isConnected;
                            const isPrimary = device.id === activeDeviceId;

                            return (
                                <div key={device.id} className={`flex items-center gap-4 p-3 rounded-lg border ${isPrimary ? 'bg-primary/5 border-primary/20' : 'bg-secondary/50 border-transparent'}`}>
                                    <Server className={`${isPrimary ? 'text-primary' : 'text-muted-foreground'}`} />
                                    <div className="flex-grow">
                                        <div className="flex items-center gap-2">
                                            <p className="font-semibold">{device.name}</p>
                                            {isPrimary && (
                                                <span className="text-[10px] bg-primary text-primary-foreground px-1.5 py-0.5 rounded uppercase font-bold tracking-wider">Dashboard Utama</span>
                                            )}
                                        </div>
                                        <p className="text-xs text-muted-foreground">{device.user}@{device.host}:{device.port}</p>
                                    </div>
                                    
                                    <div className="flex items-center gap-3">
                                        <span className={`flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-full ${isOnline ? 'text-green-500 bg-green-500/10' : 'text-destructive bg-destructive/10'}`}>
                                            <div className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-green-500 animate-pulse' : 'bg-destructive'}`} />
                                            {isOnline ? 'Online' : 'Terputus'}
                                        </span>

                                        {isAdmin && (
                                            <div className="flex gap-1">
                                                <button onClick={() => handleEditClick(device)} className="p-2 rounded-md hover:bg-muted" title="Edit"><Edit size={14} /></button>
                                                <button onClick={() => handleDeleteClick(device)} className="p-2 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive" title="Hapus"><Trash2 size={14} /></button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })
                    ) : (
                        <div className="text-center py-6">
                            <p className="text-muted-foreground mb-4">Belum ada perangkat, nih.</p>
                            {isAdmin && (
                                <Button variant="outline" onClick={handleAddClick}>
                                    <Plus size={16} className="mr-2" /> Tambahkan MikroTik
                                </Button>
                            )}
                        </div>
                    )}
                </CardContent>
            </Card>

            <DeviceModal
                isOpen={isDeviceModalOpen}
                onClose={() => setIsDeviceModalOpen(false)}
                onSuccess={handleSuccess}
                deviceToEdit={deviceToProcess}
            />

            <ConfirmModal
                isOpen={isDeleteModalOpen}
                onClose={() => setIsDeleteModalOpen(false)}
                onConfirm={handleDeleteConfirm}
                title="Konfirmasi Hapus Perangkat"
                description={`Anda yakin ingin menghapus perangkat "${deviceToProcess?.name}"? Semua data terkait mungkin akan terpengaruh.`}
                confirmText="Ya, Hapus"
                isLoading={isActionLoading}
            />
        </>
    );
};

export default DeviceManagementCard;