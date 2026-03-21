'use client';

import React, { useState, useEffect } from 'react';
import { Server, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '../providers/auth-provider';
import { apiFetch } from '@/utils/api';

interface Device {
  id: number;
  name: string;
  host: string;
  workspace_id?: number;
  workspace_name?: string;
}

interface DeviceSelectorProps {
  selectedDeviceId: number | null;
  onDeviceChange: (deviceId: number | null) => void;
  className?: string;
}

export const DeviceSelector: React.FC<DeviceSelectorProps> = ({
  selectedDeviceId,
  onDeviceChange,
  className = ''
}) => {
  const { user } = useAuth();
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeDeviceId, setActiveDeviceId] = useState<number | null>(null);

  useEffect(() => {
    if (!user?.workspace_id) return;

    const fetchDevices = async () => {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
        const [devicesRes, workspaceRes] = await Promise.all([
          apiFetch(`${apiUrl}/api/devices`),
          apiFetch(`${apiUrl}/api/workspaces/me`)
        ]);

        if (devicesRes.ok && workspaceRes.ok) {
          const devicesData = await devicesRes.json();
          const workspaceData = await workspaceRes.json();

          setDevices(devicesData);
          setActiveDeviceId(workspaceData.active_device_id);

          // Jika belum ada selectedDeviceId (dan tidak ada di localStorage), gunakan active_device_id
          const savedLocalDevice = localStorage.getItem(`selected-device-${user.workspace_id}`);
          if (!selectedDeviceId && workspaceData.active_device_id && !savedLocalDevice) {
            setTimeout(() => {
              if (!selectedDeviceId) {
                onDeviceChange(workspaceData.active_device_id);
              }
            }, 200);
          }
        }
      } catch (error) {
        console.error('Error fetching devices:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchDevices();
  }, [user?.workspace_id, selectedDeviceId]);

  const selectedDevice = devices.find(d => d.id === selectedDeviceId);
  
  // Tampilkan nama workspace jika device bukan dari workspace utama user
  const isDifferentWorkspace = selectedDevice && selectedDevice.workspace_id !== user?.workspace_id;
  const displayName = selectedDevice 
    ? (isDifferentWorkspace ? `${selectedDevice.name} (${selectedDevice.workspace_name})` : selectedDevice.name) 
    : (activeDeviceId ? 'Loading...' : 'Pilih Device');

  if (loading) {
    return (
      <Button variant="outline" disabled className={className}>
        <Server className="mr-2 h-4 w-4" />
        Memuat...
      </Button>
    );
  }

  if (devices.length === 0) {
    return (
      <Button variant="outline" disabled className={className}>
        <Server className="mr-2 h-4 w-4" />
        Tidak ada device
      </Button>
    );
  }

  const handleSelect = async (deviceId: number) => {
    onDeviceChange(deviceId);
    
    // Jika admin, simpan pilihan ini ke DB sebagai default untuk workspace
    if (user?.role === 'admin') {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
        await apiFetch(`${apiUrl}/api/workspaces/set-active-device`, {
          method: 'POST',
          body: JSON.stringify({ deviceId })
        });
      } catch (error) {
        console.error('[DeviceSelector] Gagal update pilihan utama di workspace:', error);
      }
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className={className}>
          <Server className="mr-2 h-4 w-4 text-primary" />
          <span className="max-w-[250px] truncate font-semibold">{displayName}</span>
          <ChevronDown className="ml-2 h-4 w-4 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {devices.map((device) => (
          <DropdownMenuItem
            key={device.id}
            onClick={() => handleSelect(device.id)}
            className={`flex items-center justify-between py-2 ${selectedDeviceId === device.id ? 'bg-primary/10 text-primary' : ''}`}
          >
            <div className="flex flex-col gap-0.5 overflow-hidden">
              <span className="font-bold text-sm truncate">{device.name}</span>
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground uppercase tracking-tight">
                {device.workspace_name && (
                  <>
                    <span className="font-semibold text-primary/70">{device.workspace_name}</span>
                    <span>•</span>
                  </>
                )}
                <span>{device.host}</span>
              </div>
            </div>
            {selectedDeviceId === device.id && (
              <span className="ml-2 text-primary">✓</span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

