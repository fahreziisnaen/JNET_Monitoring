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
  const { selectedDeviceId, setSelectedDeviceId, pppoeSecrets } = useMikrotik() || {};
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isIpPoolModalOpen, setIsIpPoolModalOpen] = useState(false);
  const [summary, setSummary] = useState({ total: 0, active: 0, inactive: 0 });
  const [loading, setLoading] = useState(false);
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

  // Tidak perlu fetchSummary lagi, semua data dari WebSocket
  const fetchSummary = useCallback(async () => {
    // Function ini tetap ada untuk backward compatibility tapi tidak melakukan apa-apa
    // Semua data sekarang dari WebSocket
    console.log('[Management Page] fetchSummary dipanggil, tapi data sekarang dari WebSocket');
  }, []);

  // Update summary secara real-time dari WebSocket data (sama seperti summary aktif)
  useEffect(() => {
    if (!selectedDeviceId) {
      setSummary({ total: 0, active: 0, inactive: 0 });
      setLoading(false);
      return;
    }
    
    // Gunakan data WebSocket untuk semua summary (sama seperti summary aktif)
    const secretsArray = Array.isArray(pppoeSecrets) ? pppoeSecrets : [];
    
    const totalSecrets = secretsArray.length;
    const activeCount = secretsArray.filter((secret: any) => secret.isActive === true).length;
    const inactiveCount = Math.max(0, totalSecrets - activeCount);
    
    // Update summary dari WebSocket data (real-time, sama seperti aktif)
    setSummary(prev => {
      // Hanya update jika ada perubahan
      if (prev.total !== totalSecrets || prev.active !== activeCount || prev.inactive !== inactiveCount) {
        console.log('[Management Page] Update summary dari WebSocket:', {
          total: totalSecrets,
          active: activeCount,
          inactive: inactiveCount,
          pppoeSecretsCount: secretsArray.length
        });
        
        return {
          total: totalSecrets,
          active: activeCount,
          inactive: inactiveCount
        };
      }
      
      return prev;
    });
    
    // Set loading ke false jika ada data WebSocket
    if (loading && totalSecrets > 0) {
      console.log('[Management Page] Set loading ke false karena ada data WebSocket');
      setLoading(false);
    }
  }, [pppoeSecrets, selectedDeviceId, loading]);

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