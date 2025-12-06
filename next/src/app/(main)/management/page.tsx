'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Users, UserCheck, UserX, Plus, Settings, Loader2, RefreshCw } from 'lucide-react';
import { useAuth } from '@/components/providers/auth-provider';
import { useMikrotik } from '@/components/providers/mikrotik-provider';
import { DeviceSelector } from '@/components/ui/device-selector';
import { NoDeviceMessage } from '@/components/ui/no-device-message';
import SummaryCard from '@/components/dashboard/summary-card';
import AddPppoeSecretModal from '@/components/management/add-pppoe-secret-modal';
import IpPoolManagerModal from '@/components/management/ip-pool-manager-modal';
import PppoeSecretsTable from '@/components/management/pppoe-secrets-table';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/utils/api';

const ManagementPage = () => {
  const { user } = useAuth();
  const { selectedDeviceId, setSelectedDeviceId } = useMikrotik() || {};
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isIpPoolModalOpen, setIsIpPoolModalOpen] = useState(false);
  const [summary, setSummary] = useState({ total: 0, active: 0, inactive: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('all');
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

  const fetchSummary = useCallback(async () => {
    if (!selectedDeviceId || !hasDevices) {
      console.log('[Management Page] Skip fetch - selectedDeviceId:', selectedDeviceId, 'hasDevices:', hasDevices);
      setLoading(false);
      setSummary({ total: 0, active: 0, inactive: 0 });
      return;
    }
    
    console.log('[Management Page] Fetching summary untuk deviceId:', selectedDeviceId);
    setLoading(true);
    let timeoutId: NodeJS.Timeout | null = null;
    const controller = new AbortController();
    
    try {
        const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
        
        // Tambahkan timeout 20 detik (lebih lama dari backend timeout 15 detik)
        timeoutId = setTimeout(() => {
          if (!controller.signal.aborted) {
            console.warn('[Management Page] Request timeout setelah 20 detik');
            controller.abort();
          }
        }, 20000);
        
        const response = await apiFetch(`${apiUrl}/api/pppoe/summary?deviceId=${selectedDeviceId}`, {
          signal: controller.signal
        });
        
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        
        if (controller.signal.aborted) {
          console.log('[Management Page] Request di-abort, skip update state');
          return;
        }
        
        if (!response.ok) {
          const errorText = await response.text().catch(() => 'Unknown error');
          throw new Error(`Gagal mengambil data summary: ${response.status} ${response.statusText} - ${errorText}`);
        }
        
        const data = await response.json();
        console.log('[Management Page] Summary data diterima:', data);
        setSummary({
          total: data?.total ?? 0,
          active: data?.active ?? 0,
          inactive: data?.inactive ?? 0
        });
    } catch (error: any) {
        // Handle AbortError dengan benar
        if (error?.name === 'AbortError' || error?.message?.includes('aborted')) {
          console.warn('[Management Page] Request di-abort (timeout atau cancelled)');
        } else {
          console.error('[Management Page] Error fetching summary:', error);
        }
        // Set default values jika error
        setSummary({ total: 0, active: 0, inactive: 0 });
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
        console.log('[Management Page] Set loading ke false');
        setLoading(false);
    }
  }, [selectedDeviceId, hasDevices]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary, refreshTrigger]);

  const handleSuccess = () => {
      setRefreshTrigger(prev => prev + 1);
  };

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchSummary();
    setRefreshTrigger(prev => prev + 1);
    setTimeout(() => setRefreshing(false), 500);
  }, [fetchSummary]);
  
  const renderSummaryCard = (title: string, count: number, icon: React.ReactNode, color: string, filter: 'all' | 'active' | 'inactive') => (
      <button onClick={() => setActiveFilter(filter)} className={`w-full text-left rounded-lg transition-all ${activeFilter === filter ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''}`}>
          <SummaryCard title={title} count={loading ? <Loader2 className="animate-spin" /> : count} icon={icon} colorClass={color} />
      </button>
  );

  if (hasDevices === null) {
    return (
      <div className="p-4 md:p-8">
        <div className="flex justify-between items-center flex-wrap gap-4 mb-6">
          <h1 className="text-3xl font-bold">Manajemen PPPoE</h1>
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
      <div className="p-4 md:p-8">
        <div className="flex justify-between items-center flex-wrap gap-4 mb-6">
          <h1 className="text-3xl font-bold">Manajemen PPPoE</h1>
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
      <div className="p-4 md:p-8">
        <div className="flex justify-between items-center flex-wrap gap-4 mb-6">
          <h1 className="text-3xl font-bold">Manajemen PPPoE</h1>
          <div className="flex items-center gap-2">
            <DeviceSelector 
              selectedDeviceId={selectedDeviceId}
              onDeviceChange={setSelectedDeviceId}
            />
            <Button variant="outline" onClick={handleRefresh} disabled={refreshing || loading}>
              <RefreshCw size={18} className={`mr-2 ${refreshing ? 'animate-spin' : ''}`}/> Refresh
            </Button>
            <Button variant="secondary" onClick={() => setIsIpPoolModalOpen(true)}>
              <Settings size={18} className="mr-2"/> Atur IP Pool
            </Button>
            <Button onClick={() => setIsAddModalOpen(true)}>
              <Plus size={18} className="mr-2"/> Tambah Secret
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {renderSummaryCard("Total Secrets", summary.total, <Users size={28}/>, "bg-gradient-to-br from-blue-500 to-blue-700", 'all')}
          {renderSummaryCard("Aktif", summary.active, <UserCheck size={28}/>, "bg-gradient-to-br from-green-500 to-green-700", 'active')}
          {renderSummaryCard("Tidak Aktif", summary.inactive, <UserX size={28}/>, "bg-gradient-to-br from-red-500 to-red-700", 'inactive')}
        </div>
        <div className="mt-8">
          <PppoeSecretsTable refreshTrigger={refreshTrigger} onActionComplete={handleSuccess} initialFilter={activeFilter} />
        </div>
      </div>
      <AddPppoeSecretModal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} onSuccess={handleSuccess} />
      <IpPoolManagerModal isOpen={isIpPoolModalOpen} onClose={() => setIsIpPoolModalOpen(false)} />
    </>
  );
};
export default ManagementPage;