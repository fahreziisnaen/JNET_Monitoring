'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Search, Loader2 } from 'lucide-react';
import { useAuth } from '@/components/providers/auth-provider';
import { useMikrotik } from '@/components/providers/mikrotik-provider';
import { DeviceSelector } from '@/components/ui/device-selector';
import { NoDeviceMessage } from '@/components/ui/no-device-message';
import { Card, CardContent } from '@/components/ui/card';
import { motion } from '@/components/motion';
import SlaDetailModal from '@/components/sla/sla-detail-modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiFetch } from '@/utils/api';

interface SlaUser {
  name: string;
  profile: string;
}

const SlaPage = () => {
  const { user } = useAuth();
  const { selectedDeviceId, setSelectedDeviceId } = useMikrotik() || {};
  const [allUsers, setAllUsers] = useState<SlaUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
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

  const fetchUsers = useCallback(async () => {
    if (!selectedDeviceId || !hasDevices) {
      console.log('[SLA Page] Skip fetch - selectedDeviceId:', selectedDeviceId, 'hasDevices:', hasDevices);
      setLoading(false);
      setAllUsers([]);
      return;
    }
    
    console.log('[SLA Page] Fetching users untuk deviceId:', selectedDeviceId);
    setLoading(true);
    let timeoutId: NodeJS.Timeout | null = null;
    const controller = new AbortController();
    
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
      
      // Tambahkan timeout 20 detik (lebih lama dari backend timeout 15 detik)
      timeoutId = setTimeout(() => {
        if (!controller.signal.aborted) {
          console.warn('[SLA Page] Request timeout setelah 20 detik');
          controller.abort();
        }
      }, 20000);
      
      const res = await apiFetch(`${apiUrl}/api/pppoe/secrets?disabled=false&deviceId=${selectedDeviceId}`, {
        signal: controller.signal
      });
      
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      
      if (controller.signal.aborted) {
        console.log('[SLA Page] Request di-abort, skip update state');
        return;
      }
      
      if (!res.ok) {
        const errorText = await res.text().catch(() => 'Unknown error');
        throw new Error(`Gagal mengambil daftar pengguna PPPoE: ${res.status} ${res.statusText} - ${errorText}`);
      }
      
      const data = await res.json();
      console.log('[SLA Page] Users data diterima, jumlah:', Array.isArray(data) ? data.length : 0);
      setAllUsers(Array.isArray(data) ? data : []);
    } catch (error: any) {
        // Handle AbortError dengan benar
        if (error?.name === 'AbortError' || error?.message?.includes('aborted')) {
          console.warn('[SLA Page] Request di-abort (timeout atau cancelled)');
        } else {
          console.error('[SLA Page] Error fetching users:', error);
        }
        // Set empty array jika error
        setAllUsers([]);
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
        console.log('[SLA Page] Set loading ke false');
        setLoading(false);
    }
  }, [selectedDeviceId, hasDevices]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const filteredUsers = useMemo(() => {
    const usersToDisplay = allUsers.filter(user =>
        user.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
    usersToDisplay.sort((a, b) => a.name.localeCompare(b.name));

    return usersToDisplay;
  }, [allUsers, searchTerm]);

  const handleOpenModal = (userName: string) => {
    setSelectedUser(userName);
    setIsModalOpen(true);
  };

  if (hasDevices === null) {
    return (
      <div className="p-4 md:p-8 max-w-6xl mx-auto h-full flex flex-col">
        <div className="flex-shrink-0">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h1 className="text-3xl font-bold">Laporan SLA Pelanggan</h1>
              <p className="text-muted-foreground">
                Ringkasan performa dan uptime pengguna PPPoE dalam 30 hari terakhir.
              </p>
            </div>
            <DeviceSelector 
              selectedDeviceId={selectedDeviceId}
              onDeviceChange={setSelectedDeviceId}
            />
          </div>
        </div>
        <div className="flex items-center justify-center min-h-[400px]">
          <p className="text-muted-foreground">Memuat...</p>
        </div>
      </div>
    );
  }

  if (!hasDevices) {
    return (
      <div className="p-4 md:p-8 max-w-6xl mx-auto h-full flex flex-col">
        <div className="flex-shrink-0">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h1 className="text-3xl font-bold">Laporan SLA Pelanggan</h1>
              <p className="text-muted-foreground">
                Ringkasan performa dan uptime pengguna PPPoE dalam 30 hari terakhir.
              </p>
            </div>
            <DeviceSelector 
              selectedDeviceId={selectedDeviceId}
              onDeviceChange={setSelectedDeviceId}
            />
          </div>
        </div>
        <NoDeviceMessage />
      </div>
    );
  }

  return (
    <>
      <div className="p-4 md:p-8 max-w-6xl mx-auto h-full flex flex-col">
        <div className="flex-shrink-0">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h1 className="text-3xl font-bold">Laporan SLA Pelanggan</h1>
              <p className="text-muted-foreground">
                Ringkasan performa dan uptime pengguna PPPoE dalam 30 hari terakhir.
              </p>
            </div>
            <DeviceSelector 
              selectedDeviceId={selectedDeviceId}
              onDeviceChange={setSelectedDeviceId}
            />
          </div>
          <div className="mb-6 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
              <Input
                  type="text"
                  placeholder="Cari nama pengguna..."
                  className="w-full pl-10"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
              />
          </div>
        </div>
        <Card className="flex-1 min-h-0">
          <CardContent className="p-0 h-full flex flex-col">
            <div className="overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="text-left bg-secondary sticky top-0 z-10">
                  <tr>
                    <th className="p-4 font-semibold">Pengguna</th>
                    <th className="p-4 font-semibold">Profil</th>
                    <th className="p-4 font-semibold text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={3} className="text-center p-10"><Loader2 className="h-8 w-8 animate-spin mx-auto text-primary"/></td></tr>
                  ) : filteredUsers.length > 0 ? (
                    filteredUsers.map((user, i) => (
                      <motion.tr
                        key={user.name}
                        className="border-b border-border"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.3, delay: i * 0.05 }}
                      >
                        <td className="p-4 font-medium">{user.name}</td>
                        <td className="p-4">{user.profile}</td>
                        <td className="p-4 text-center">
                          <Button variant="ghost" onClick={() => handleOpenModal(user.name)}>
                            Lihat Detail SLA
                          </Button>
                        </td>
                      </motion.tr>
                    ))
                  ) : (
                    <tr><td colSpan={3} className="text-center p-10 text-muted-foreground">
                        {searchTerm ? `Tidak ada pengguna dengan nama "${searchTerm}".` : 'Tidak ada pengguna PPPoE yang aktif.'}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      <SlaDetailModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        userName={selectedUser}
      />
    </>
  );
};
export default SlaPage;