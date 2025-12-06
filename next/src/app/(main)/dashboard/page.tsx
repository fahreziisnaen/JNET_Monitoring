'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/components/providers/auth-provider';
import { useMikrotik } from '@/components/providers/mikrotik-provider';
import { DeviceSelector } from '@/components/ui/device-selector';
import { NoDeviceMessage } from '@/components/ui/no-device-message';
import MainContent from '@/components/dashboard/main-content';
import Sidebar from '@/components/dashboard/sidebar';
import { apiFetch } from '@/utils/api';

const DashboardPage = () => {
  const { user } = useAuth();
  const { selectedDeviceId, setSelectedDeviceId } = useMikrotik() || {};
  const [hasDevices, setHasDevices] = useState<boolean | null>(null);

  useEffect(() => {
    if (!user?.workspace_id) return;

    const checkDevices = async () => {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
        const res = await apiFetch(`${apiUrl}/api/devices`);
        if (res.ok) {
          const devices = await res.json();
          setHasDevices(Array.isArray(devices) && devices.length > 0);
        } else {
          setHasDevices(false);
        }
      } catch (error) {
        console.error('Error checking devices:', error);
        setHasDevices(false);
      }
    };

    checkDevices();
  }, [user?.workspace_id]);

  if (hasDevices === null) {
    return (
      <div className="p-4 md:p-6 lg:p-8 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">
              Selamat Datang, {user?.displayName}!
            </h1>
            <p className="text-muted-foreground mt-1">
              Ini ringkasan aktivitas jaringan lo saat ini.
            </p>
          </div>
          <DeviceSelector 
            selectedDeviceId={selectedDeviceId}
            onDeviceChange={setSelectedDeviceId}
          />
        </div>
        <div className="flex items-center justify-center min-h-[400px]">
          <p className="text-muted-foreground">Memuat...</p>
        </div>
      </div>
    );
  }

  if (!hasDevices) {
    return (
      <div className="p-4 md:p-6 lg:p-8 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">
              Selamat Datang, {user?.displayName}!
            </h1>
            <p className="text-muted-foreground mt-1">
              Ini ringkasan aktivitas jaringan lo saat ini.
            </p>
          </div>
          <DeviceSelector 
            selectedDeviceId={selectedDeviceId}
            onDeviceChange={setSelectedDeviceId}
          />
        </div>
        <NoDeviceMessage />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">
            Selamat Datang, {user?.displayName}!
          </h1>
          <p className="text-muted-foreground mt-1">
            Ini ringkasan aktivitas jaringan lo saat ini.
          </p>
        </div>
        <DeviceSelector 
          selectedDeviceId={selectedDeviceId}
          onDeviceChange={setSelectedDeviceId}
        />
      </div>
      <div className="flex flex-col lg:flex-row gap-6">
        <MainContent />
        <Sidebar />
      </div>
    </div>
  );
};

export default DashboardPage;