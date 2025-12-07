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
          
          // Jika belum ada selectedDeviceId, gunakan active_device_id
          // Hanya panggil onDeviceChange jika benar-benar perlu untuk menghindari infinite loop
          // Tambahkan delay kecil untuk memastikan state sudah ter-update
          if (!selectedDeviceId && workspaceData.active_device_id) {
            // Delay untuk memastikan tidak ada race condition dengan WebSocket connection
            setTimeout(() => {
              if (!selectedDeviceId) { // Double check setelah delay
                console.log('[DeviceSelector] Setting initial device:', workspaceData.active_device_id);
                onDeviceChange(workspaceData.active_device_id);
              }
            }, 200); // 200ms delay
          }
        }
      } catch (error) {
        console.error('Error fetching devices:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchDevices();
    // Hapus onDeviceChange dari dependency untuk menghindari re-render berulang
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.workspace_id, selectedDeviceId]);

  const selectedDevice = devices.find(d => d.id === selectedDeviceId);
  const displayName = selectedDevice ? selectedDevice.name : (activeDeviceId ? 'Loading...' : 'Pilih Device');

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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className={className}>
          <Server className="mr-2 h-4 w-4" />
          <span className="max-w-[200px] truncate">{displayName}</span>
          <ChevronDown className="ml-2 h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {devices.map((device) => (
          <DropdownMenuItem
            key={device.id}
            onClick={() => onDeviceChange(device.id)}
            className={selectedDeviceId === device.id ? 'bg-accent' : ''}
          >
            <div className="flex flex-col">
              <span className="font-medium">{device.name}</span>
              <span className="text-xs text-muted-foreground">{device.host}</span>
            </div>
            {selectedDeviceId === device.id && (
              <span className="ml-auto text-xs">✓</span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

