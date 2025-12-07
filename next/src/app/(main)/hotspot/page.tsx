'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Users, Wifi, Plus, Loader2 } from 'lucide-react';
import { useAuth } from '@/components/providers/auth-provider';
import { useMikrotik } from '@/components/providers/mikrotik-provider';
import { DeviceSelector } from '@/components/ui/device-selector';
import { NoDeviceMessage } from '@/components/ui/no-device-message';
import SummaryCard from '@/components/dashboard/summary-card';
import HotspotActiveList from '@/components/hotspot/hotspot-active-list';
import HotspotUserList from '@/components/hotspot/hotspot-user-list';
import AddHotspotUserModal from '@/components/hotspot/add-hotspot-user-modal';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/utils/api';

const HotspotPage = () => {
  const { user } = useAuth();
  const { selectedDeviceId, setSelectedDeviceId } = useMikrotik() || {};
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [summary, setSummary] = useState({ totalUsers: 0, activeUsers: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [hasDevices, setHasDevices] = useState<boolean | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

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

  const fetchSummary = useCallback(async () => {
    if (!selectedDeviceId || !hasDevices) return;
    
    // Abort request sebelumnya jika ada
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    
    console.log('[Hotspot Page] Fetching summary...');
    setLoading(true);
    let timeoutId: NodeJS.Timeout | null = null;
    
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
      // Buat AbortController baru untuk request ini
      const controller = new AbortController();
      abortControllerRef.current = controller;
      
      // Tambahkan timeout 25 detik (lebih lama dari backend timeout 18 detik + buffer)
      timeoutId = setTimeout(() => {
        if (!controller.signal.aborted) {
        console.warn('[Hotspot Page] Request timeout setelah 25 detik');
        controller.abort();
        }
      }, 25000); // 25 detik timeout
      
      const res = await apiFetch(`${apiUrl}/api/hotspot/summary?deviceId=${selectedDeviceId}`, {
        signal: controller.signal
      });
      
      // Clear timeout jika request berhasil sebelum timeout
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      
      // Cek apakah request sudah di-abort (component mungkin sudah unmount)
      if (controller.signal.aborted) {
        return;
      }
      
      if (!res.ok) {
        console.error('[Hotspot Page] Response tidak OK:', res.status, res.statusText);
        // Jika error, set default values
        setSummary({ totalUsers: 0, activeUsers: 0 });
        setLoading(false);
        return;
      }
      const data = await res.json();
      console.log('[Hotspot Page] Summary data diterima:', data);
      // Pastikan data valid, jika tidak set default
      setSummary({
        totalUsers: data?.totalUsers ?? 0,
        activeUsers: data?.activeUsers ?? 0
      });
    } catch (error: any) { 
      // Handle AbortError dengan benar (timeout atau cancelled)
      if (error?.name === 'AbortError' || error?.message?.includes('aborted')) {
        // Jangan log sebagai error jika ini adalah abort yang disengaja
        // Hanya log jika bukan dari timeout (bisa jadi component unmount)
        if (!error.message?.includes('timeout')) {
          console.warn('[Hotspot Page] Request di-cancel');
        }
        // Set default values
        setSummary({ totalUsers: 0, activeUsers: 0 });
      } else {
      console.error('[Hotspot Page] Error fetching summary:', error);
        // Set default values jika error lainnya
      setSummary({ totalUsers: 0, activeUsers: 0 });
      }
    } finally { 
      if (timeoutId) clearTimeout(timeoutId);
      // Pastikan loading selalu di-set ke false
      setLoading(false); 
      // Clear controller ref jika request ini sudah selesai
      if (abortControllerRef.current?.signal.aborted === false) {
        abortControllerRef.current = null;
      }
    }
  }, [selectedDeviceId, hasDevices]);

  useEffect(() => { 
    fetchSummary(); 
  }, [fetchSummary, refreshTrigger]);
  
  // Cleanup saat component unmount - abort request yang sedang berjalan
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      setLoading(false);
    };
  }, []);
  
  const handleSuccess = () => { setRefreshTrigger(prev => prev + 1); };

  if (hasDevices === null) {
    return (
      <div className="p-4 md:p-8 space-y-8">
        <div className="flex justify-between items-center flex-wrap gap-4">
          <h1 className="text-3xl font-bold">Manajemen Hotspot</h1>
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
      <div className="p-4 md:p-8 space-y-8">
        <div className="flex justify-between items-center flex-wrap gap-4">
          <h1 className="text-3xl font-bold">Manajemen Hotspot</h1>
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
    <>
      <div className="p-4 md:p-8 space-y-8">
        <div className="flex justify-between items-center flex-wrap gap-4">
          <h1 className="text-3xl font-bold">Manajemen Hotspot</h1>
          <div className="flex items-center gap-2">
            <DeviceSelector 
              selectedDeviceId={selectedDeviceId}
              onDeviceChange={setSelectedDeviceId}
            />
          <Button onClick={() => setIsModalOpen(true)}>
            <Plus size={18} className="mr-2"/> Tambah User
          </Button>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <SummaryCard title="Total User Hotspot" count={loading ? <Loader2 className="animate-spin"/> : summary.totalUsers} icon={<Users size={28}/>} colorClass="bg-gradient-to-br from-sky-500 to-sky-700" />
          <SummaryCard title="User Aktif" count={loading ? <Loader2 className="animate-spin"/> : summary.activeUsers} icon={<Wifi size={28}/>} colorClass="bg-gradient-to-br from-emerald-500 to-emerald-700" />
        </div>
        <HotspotActiveList />
        <HotspotUserList refreshTrigger={refreshTrigger} onActionComplete={handleSuccess} />
      </div>
      <AddHotspotUserModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSuccess={handleSuccess} />
    </>
  );
};
export default HotspotPage;