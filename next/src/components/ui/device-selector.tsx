'use client';

import React, { useState, useEffect } from 'react';
import { Server, ChevronDown, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
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
  selectedDeviceIds?: number[];
  onDevicesChange?: (deviceIds: number[]) => void;
  // Backward compatibility
  selectedDeviceId?: number | null;
  onDeviceChange?: (deviceId: number) => void;
  className?: string;
}

export const DeviceSelector: React.FC<DeviceSelectorProps> = ({
  selectedDeviceIds: propsSelectedDeviceIds,
  onDevicesChange: propsOnDevicesChange,
  selectedDeviceId,
  onDeviceChange,
  className = ''
}) => {
  const selectedDeviceIds = propsSelectedDeviceIds || (selectedDeviceId ? [selectedDeviceId] : []);
  const onDevicesChange = propsOnDevicesChange || (onDeviceChange ? (ids: number[]) => onDeviceChange(ids[0]) : () => {});
  const { user } = useAuth();
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.workspace_id) return;

    const fetchDevices = async () => {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
        const devicesRes = await apiFetch(`${apiUrl}/api/devices`);

        if (devicesRes.ok) {
          const devicesData = await devicesRes.json();
          setDevices(devicesData);

          // Jika belum ada selectedDeviceIds, coba load dari localStorage atau gunakan default
          const savedLocalDevices = localStorage.getItem(`selected-devices-v2-${user.workspace_id}`);
          if (selectedDeviceIds.length === 0 && !savedLocalDevices && devicesData.length > 0) {
            // Default: pilih semua device saat pertama kali
            onDevicesChange(devicesData.map((d: Device) => d.id));
          }
        }
      } catch (error) {
        console.error('Error fetching devices:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchDevices();
  }, [user?.workspace_id]);

  const toggleDevice = (deviceId: number) => {
    const nextIds = selectedDeviceIds.includes(deviceId)
      ? selectedDeviceIds.filter(id => id !== deviceId)
      : [...selectedDeviceIds, deviceId];
    onDevicesChange(nextIds);
  };

  const selectAll = () => {
    onDevicesChange(devices.map(d => d.id));
  };

  const deselectAll = () => {
    onDevicesChange([]);
  };

  const displayName = selectedDeviceIds.length === 0 
    ? 'Pilih Device' 
    : selectedDeviceIds.length === 1 
      ? devices.find(d => d.id === selectedDeviceIds[0])?.name || '1 Device'
      : `${selectedDeviceIds.length} Device Terpilih`;

  if (loading) {
    return (
      <Button variant="outline" disabled className={className}>
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Memuat...
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className={cn("min-w-[160px] justify-between", className)}>
          <div className="flex items-center gap-2 overflow-hidden">
            <Server className={cn("h-4 w-4 shrink-0", selectedDeviceIds.length > 0 ? "text-primary" : "text-muted-foreground")} />
            <span className="truncate font-semibold">{displayName}</span>
          </div>
          <ChevronDown className="h-4 w-4 opacity-50 shrink-0 ml-2" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 p-0" onCloseAutoFocus={(e) => e.preventDefault()}>
        <div className="p-2 border-b bg-muted/30 flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold uppercase text-muted-foreground ml-1">Pilih MikroTik</span>
            <div className="flex gap-1">
                <Button variant="ghost" size="sm" onClick={selectAll} className="h-6 px-2 text-[10px]">Semua</Button>
                <Button variant="ghost" size="sm" onClick={deselectAll} className="h-6 px-2 text-[10px]">Bersihkan</Button>
            </div>
        </div>
        <div className="max-h-[300px] overflow-y-auto p-1">
            {devices.length === 0 ? (
                <div className="p-4 text-center text-sm text-muted-foreground">Tidak ada device</div>
            ) : (
                devices.map((device) => {
                    const isSelected = selectedDeviceIds.includes(device.id);
                    return (
                        <div
                            key={device.id}
                            onClick={() => toggleDevice(device.id)}
                            className={cn(
                                "flex items-center gap-3 px-2 py-2.5 rounded-md cursor-pointer transition-colors hover:bg-accent group",
                                isSelected ? "bg-primary/5" : ""
                            )}
                        >
                            <div className={cn(
                                "w-4 h-4 rounded border flex items-center justify-center transition-colors",
                                isSelected ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/30 group-hover:border-primary"
                            )}>
                                {isSelected && <span className="text-[10px]">✓</span>}
                            </div>
                            <div className="flex flex-col gap-0.5 overflow-hidden flex-1">
                                <span className={cn("font-bold text-sm truncate", isSelected ? "text-primary" : "")}>{device.name}</span>
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
                        </div>
                    );
                })
            )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

