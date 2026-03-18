'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Users, UserCheck, UserX, Plus, Settings, Loader2 } from 'lucide-react';
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
import { usePageTitle } from '@/hooks/usePageTitle';

const ManagementPage = () => {
  usePageTitle('Manajemen PPPoE');
  const { user } = useAuth();
  const { selectedDeviceId, setSelectedDeviceId, pppoeSecrets, forceRefresh, isConnected } = useMikrotik() || {};
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isIpPoolModalOpen, setIsIpPoolModalOpen] = useState(false);
  const [summary, setSummary] = useState({ total: 0, active: 0, inactive: 0 });
  // loading hanya true saat kita belum tahu status koneksi awal
  const [loading, setLoading] = useState(true);
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

  // Ensure auto update triggers correctly on reconnection
  useEffect(() => {
    if (isConnected === true) {
      if (forceRefresh) forceRefresh();
      setLoading(false);
    } else {
      // Tunggu sebentar sebelum menunjukkan offline, untuk memberi waktu WS konek
      const timer = setTimeout(() => {
        setLoading(false);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [isConnected, forceRefresh]);

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

    // Gunakan data WebSocket untuk semua summary
    const secretsArray = Array.isArray(pppoeSecrets) ? pppoeSecrets : [];
    const totalSecrets = secretsArray.length;
    const activeCount = secretsArray.filter((secret: any) => secret.isActive === true).length;
    const inactiveCount = Math.max(0, totalSecrets - activeCount);

    // Selalu update summary (termasuk saat data dikosongkan saat ganti device)
    setSummary(prev => {
      if (prev.total !== totalSecrets || prev.active !== activeCount || prev.inactive !== inactiveCount) {
        return { total: totalSecrets, active: activeCount, inactive: inactiveCount };
      }
      return prev;
    });

    // Matikan loading setelah ada response (data kosong pun dihitung)
    if (loading) {
      setLoading(false);
    }
  }, [pppoeSecrets, selectedDeviceId, loading]);

  const handleSuccess = () => {
    // Panggil forceRefresh untuk meminta data terbaru segera lewat WebSocket
    if (forceRefresh) {
      forceRefresh();
    }
  };

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
      <div className="p-3 sm:p-4 md:p-8">
        <div className="flex flex-col lg:flex-row lg:justify-between lg:items-center gap-4 mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold">Manajemen PPPoE</h1>
          <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap lg:justify-end">
            <DeviceSelector
              selectedDeviceId={selectedDeviceId}
              onDeviceChange={setSelectedDeviceId}
              className="w-full sm:w-auto"
            />
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <Button variant="secondary" onClick={() => setIsIpPoolModalOpen(true)} className="flex-1 sm:flex-none" disabled={!isConnected}>
                <Settings size={18} /> <span className="hidden sm:inline">Atur IP Pool</span>
              </Button>
              <Button onClick={() => setIsAddModalOpen(true)} className="flex-1 sm:flex-none" disabled={!isConnected}>
                <Plus size={18} /> <span className="hidden sm:inline text-xs sm:text-sm">Tambah</span>
              </Button>
            </div>
          </div>
        </div>

        {!isConnected && !loading ? (
          <div className="flex flex-col items-center justify-center p-12 bg-secondary/50 rounded-xl border border-destructive/20 mt-8">
            <div className="h-16 w-16 bg-destructive/10 rounded-full flex items-center justify-center mb-4">
              <UserX className="h-8 w-8 text-destructive" />
            </div>
            <h2 className="text-xl font-bold mb-2">Mikrotik Terputus</h2>
            <p className="text-muted-foreground text-center max-w-md">
              Koneksi ke perangkat Mikrotik saat ini terputus. Data pelanggan tidak dapat ditampilkan hingga koneksi pulih kembali.
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 sm:gap-4 lg:gap-6">
              {renderSummaryCard("Total", summary.total, <Users />, "bg-gradient-to-br from-blue-500 to-blue-700", 'all')}
              {renderSummaryCard("Aktif", summary.active, <UserCheck />, "bg-gradient-to-br from-green-500 to-green-700", 'active')}
              {renderSummaryCard("Tidak Aktif", summary.inactive, <UserX />, "bg-gradient-to-br from-red-500 to-red-700", 'inactive')}
            </div>
            <div className="mt-8">
              <PppoeSecretsTable refreshTrigger={refreshTrigger} onActionComplete={handleSuccess} initialFilter={activeFilter} />
            </div>
          </>
        )}
      </div>
      <AddPppoeSecretModal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} onSuccess={handleSuccess} />
      <IpPoolManagerModal isOpen={isIpPoolModalOpen} onClose={() => setIsIpPoolModalOpen(false)} />
    </>
  );
};
export default ManagementPage;