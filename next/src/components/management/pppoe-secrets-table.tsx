'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from '@/components/motion';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Power, PowerOff, MoreHorizontal, Loader2, Edit, Trash2, ZapOff, Search } from 'lucide-react';
import { useMikrotik } from '@/components/providers/mikrotik-provider';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import ConfirmModal from '@/components/ui/confirm-modal';
import EditPppoeSecretModal from './edit-pppoe-secret-modal';
import { apiFetch } from '@/utils/api';

interface PppoeSecret {
  '.id': string;
  name: string;
  profile: string;
  'remote-address'?: string;
  disabled: 'true' | 'false';
  isActive?: boolean; // Status aktif dari backend
}

interface PppoeSecretsTableProps {
  refreshTrigger: number;
  onActionComplete: () => void;
  initialFilter?: 'all' | 'active' | 'inactive';
}

const PppoeSecretsTable = ({ refreshTrigger, onActionComplete, initialFilter = 'all' }: PppoeSecretsTableProps) => {
  const { pppoeActive, selectedDeviceId } = useMikrotik() || { pppoeActive: [], selectedDeviceId: null };
  const [allSecrets, setAllSecrets] = useState<PppoeSecret[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [secretToDelete, setSecretToDelete] = useState<PppoeSecret | null>(null);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [secretToEdit, setSecretToEdit] = useState<PppoeSecret | null>(null);
  const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;

  const fetchSecrets = useCallback(async () => {
    if (!selectedDeviceId) {
      setLoading(false);
      setAllSecrets([]);
      return;
    }
    
    setLoading(true);
    let timeoutId: NodeJS.Timeout | null = null;
    const controller = new AbortController();
    
    try {
      // Tambahkan timeout 20 detik (lebih lama dari backend timeout 15 detik)
      timeoutId = setTimeout(() => {
        if (!controller.signal.aborted) {
          console.warn('[PppoeSecretsTable] Request timeout setelah 20 detik');
          controller.abort();
        }
      }, 20000);
      
      const response = await apiFetch(`${apiUrl}/api/pppoe/secrets?deviceId=${selectedDeviceId}`, {
        signal: controller.signal
      });
      
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      
      if (controller.signal.aborted) {
        return;
      }
      
      if (!response.ok) {
        throw new Error(`Gagal mengambil daftar secret: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      setAllSecrets(Array.isArray(data) ? data : []);
    } catch (error: any) {
        // Handle AbortError dengan benar
        if (error?.name === 'AbortError' || error?.message?.includes('aborted')) {
          console.warn('[PppoeSecretsTable] Request di-abort (timeout atau cancelled)');
        } else {
          console.error('[PppoeSecretsTable] Error fetching secrets:', error);
        }
        // Set empty array jika error
        setAllSecrets([]);
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
      setLoading(false);
    }
  }, [apiUrl, selectedDeviceId]);

  useEffect(() => {
    fetchSecrets();
  }, [fetchSecrets, refreshTrigger]);

  const activeUsersSet = useMemo(() => new Set(pppoeActive?.map((user: any) => user.name) || []), [pppoeActive]);
  
  // Map untuk lookup uptime dari active users
  const activeUsersMap = useMemo(() => {
    const map = new Map();
    pppoeActive?.forEach((user: any) => {
      if (user.name) {
        map.set(user.name, user);
      }
    });
    return map;
  }, [pppoeActive]);
  
  // Fungsi untuk menentukan apakah secret aktif
  // Prioritas: 1) isActive dari backend, 2) WebSocket data, 3) false
  const isSecretActive = useCallback((secret: PppoeSecret): boolean => {
    // Jika backend sudah menyediakan isActive, gunakan itu
    if (secret.isActive !== undefined) {
      return secret.isActive;
    }
    // Fallback ke WebSocket data
    return activeUsersSet.has(secret.name);
  }, [activeUsersSet]);
  
  // Fungsi untuk mendapatkan uptime dari active user
  const getUptime = useCallback((secretName: string): string | null => {
    const activeUser = activeUsersMap.get(secretName);
    return activeUser?.uptime || null;
  }, [activeUsersMap]);
  
  const filteredSecrets = useMemo(() => {
    let filtered = allSecrets;
    
    // Filter berdasarkan initialFilter (active/inactive/all)
    if (initialFilter === 'active') {
      // Active: hanya yang aktif dan tidak disabled
      filtered = filtered.filter(secret => isSecretActive(secret) && secret.disabled === 'false');
    } else if (initialFilter === 'inactive') {
      // Inactive: semua yang tidak aktif (termasuk yang disabled)
      // Ini sesuai dengan perhitungan summary: inactive = total - active
      filtered = filtered.filter(secret => !isSecretActive(secret));
    }
    
    // Filter berdasarkan search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      filtered = filtered.filter(secret => {
        const nameMatch = secret.name.toLowerCase().includes(query);
        const profileMatch = secret.profile.toLowerCase().includes(query);
        const addressMatch = secret['remote-address']?.toLowerCase().includes(query);
        return nameMatch || profileMatch || addressMatch;
      });
    }
    
    return filtered;
  }, [allSecrets, isSecretActive, initialFilter, searchQuery]);
  
  const handleAction = async (action: 'enable' | 'disable' | 'kick', secret: PppoeSecret) => {
    setIsActionLoading(true);
    
    try {
        if (action === 'kick') {
            const activeUser = pppoeActive.find((u: any) => u.name === secret.name);
            if(!activeUser || !activeUser['.id']) throw new Error("User tidak aktif, tidak bisa di-kick.");
            const encodedId = encodeURIComponent(activeUser['.id']);
            const res = await apiFetch(`${apiUrl}/api/pppoe/active/${encodedId}/kick`, {
                method: 'POST'
            });
            if(!res.ok) {
                const errData = await res.json();
                throw new Error(errData.message || "Aksi gagal");
            }
        } else if (action === 'disable') {
            // Jika disable, kick user terlebih dahulu jika sedang aktif
            const activeUser = pppoeActive.find((u: any) => u.name === secret.name);
            if (activeUser && activeUser['.id']) {
                try {
                    const encodedId = encodeURIComponent(activeUser['.id']);
                    await apiFetch(`${apiUrl}/api/pppoe/active/${encodedId}/kick`, {
                        method: 'POST'
                    });
                    // Tidak perlu throw error jika kick gagal, lanjutkan disable
                } catch (kickError: any) {
                    console.warn('Gagal kick user sebelum disable:', kickError.message);
                    // Lanjutkan disable meskipun kick gagal
                }
            }
            
            // Setelah kick (jika user aktif), lakukan disable
            const encodedId = encodeURIComponent(secret['.id']);
            const res = await apiFetch(`${apiUrl}/api/pppoe/secrets/${encodedId}/status`, {
                method: 'PUT',
                body: JSON.stringify({ disabled: 'yes' })
            });
            if(!res.ok) {
                const errData = await res.json();
                throw new Error(errData.message || "Aksi gagal");
            }
        } else {
            // Enable
            const encodedId = encodeURIComponent(secret['.id']);
            const res = await apiFetch(`${apiUrl}/api/pppoe/secrets/${encodedId}/status`, {
                method: 'PUT',
                body: JSON.stringify({ disabled: 'no' })
            });
            if(!res.ok) {
                const errData = await res.json();
                throw new Error(errData.message || "Aksi gagal");
            }
        }
        
        onActionComplete();
    } catch (error: any) {
        alert(`Gagal melakukan aksi: ${error.message}`);
    } finally {
        setIsActionLoading(false);
    }
  };

  const openDeleteModal = (secret: PppoeSecret) => {
    setSecretToDelete(secret);
    setIsDeleteModalOpen(true);
  };
  
  const handleDeleteConfirm = async () => {
    if (!secretToDelete) return;
    setIsActionLoading(true);
    try {
        const encodedId = encodeURIComponent(secretToDelete['.id']);
        await apiFetch(`${apiUrl}/api/pppoe/secrets/${encodedId}`, { method: 'DELETE' });
        onActionComplete();
    } catch (error) {
        alert("Gagal menghapus secret.");
    } finally {
        setIsActionLoading(false);
        setIsDeleteModalOpen(false);
        setSecretToDelete(null);
    }
  };

  const openEditModal = (secret: PppoeSecret) => {
    setSecretToEdit(secret);
    setIsEditModalOpen(true);
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center gap-4">
            <CardTitle>Daftar Secret PPPoE ({loading ? '...' : filteredSecrets.length})</CardTitle>
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Cari nama, profil, atau IP..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 bg-input"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="h-[60vh] overflow-y-auto overscroll-contain">
            <table className="w-full text-sm">
              <thead className="text-left bg-secondary sticky top-0 z-10">
                <tr>
                  <th className="p-4 font-semibold">Status</th>
                  <th className="p-4 font-semibold">Nama</th>
                  <th className="p-4 font-semibold">Profil</th>
                  <th className="p-4 font-semibold">Remote Address</th>
                  <th className="p-4 font-semibold">Uptime</th>
                  <th className="p-4 font-semibold text-center">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                    <tr><td colSpan={6} className="text-center p-10"><Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground"/></td></tr>
                ) : filteredSecrets.length > 0 ? (
                    filteredSecrets.map((user, i) => {
                      const isActive = isSecretActive(user);
                      const uptime = getUptime(user.name);
                      return (
                        <motion.tr key={user['.id']} className="border-b" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.05 }}>
                          <td className="p-4">
                            {user.disabled === 'true' ? 
                              (<span className="flex items-center gap-2 text-muted-foreground"><PowerOff size={14} /> Disabled</span>) : 
                              isActive ? 
                              (<span className="flex items-center gap-2 text-green-500"><Power size={14} className="animate-pulse"/> Active</span>) : 
                              (<span className="flex items-center gap-2 text-red-500"><PowerOff size={14} /> Inactive</span>)
                            }
                          </td>
                          <td className="p-4 font-medium">{user.name}</td>
                          <td className="p-4">{user.profile}</td>
                          <td className="p-4 font-mono">
                            {user['remote-address'] ? (
                              <a
                                href={`http://${user['remote-address']}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:underline"
                              >
                                {user['remote-address']}
                              </a>
                            ) : (
                              'N/A'
                            )}
                          </td>
                          <td className="p-4 font-mono text-sm">
                            {uptime || 'N/A'}
                          </td>
                          <td className="p-4 text-center">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreHorizontal size={16} /></Button></DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => openEditModal(user)}>
                                  <Edit className="mr-2 h-4 w-4"/> Edit
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                {isActive && 
                                  <DropdownMenuItem onClick={() => handleAction('kick', user)}>
                                    <ZapOff className="mr-2 h-4 w-4"/> Kick User
                                  </DropdownMenuItem>
                                }
                                {user.disabled === 'true' ? 
                                  (<DropdownMenuItem onClick={() => handleAction('enable', user)}> <Power className="mr-2 h-4 w-4"/> Enable </DropdownMenuItem>) : 
                                  (<DropdownMenuItem onClick={() => handleAction('disable', user)}> <PowerOff className="mr-2 h-4 w-4"/> Disable </DropdownMenuItem>)
                                }
                                <DropdownMenuSeparator />
                                <DropdownMenuItem className="text-destructive focus:bg-destructive/10 focus:text-destructive" onClick={() => openDeleteModal(user)}>
                                  <Trash2 className="mr-2 h-4 w-4"/> Hapus
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </td>
                        </motion.tr>
                      );
                    })
                ) : (
                    <tr><td colSpan={6} className="text-center p-10 text-muted-foreground">Tidak ada secret yang cocok dengan filter.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      
      <ConfirmModal 
        isOpen={isDeleteModalOpen} 
        onClose={() => setIsDeleteModalOpen(false)} 
        onConfirm={handleDeleteConfirm} 
        title="Konfirmasi Hapus Secret" 
        description={`Anda yakin ingin menghapus secret PPPoE untuk pengguna "${secretToDelete?.name}"? Aksi ini tidak dapat dibatalkan.`} 
        confirmText="Ya, Hapus Permanen" 
        isLoading={isActionLoading}
      />
      
      <EditPppoeSecretModal 
        isOpen={isEditModalOpen} 
        onClose={() => setIsEditModalOpen(false)} 
        onSuccess={() => {
            setIsEditModalOpen(false);
            onActionComplete();
        }}
        secretToEdit={secretToEdit}
      />
    </>
  );
};

export default PppoeSecretsTable;