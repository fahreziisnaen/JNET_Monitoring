'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from '@/components/motion';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Power, PowerOff, MoreHorizontal, Loader2, Edit, Trash2, ZapOff, Search, ArrowUpDown, ChevronUp, ChevronDown } from 'lucide-react';
import { useMikrotik } from '@/components/providers/mikrotik-provider';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import ConfirmModal from '@/components/ui/confirm-modal';
import EditPppoeSecretModal from './edit-pppoe-secret-modal';
import { apiFetch } from '@/utils/api';
import { formatUptime } from '@/utils/format';

interface PppoeSecret {
  '.id': string;
  name: string;
  profile: string;
  'remote-address'?: string;
  disabled: 'true' | 'false';
  isActive?: boolean; // Status aktif dari backend
  activeConnectionId?: string; // .id dari active connection untuk keperluan kick
}

interface PppoeSecretsTableProps {
  refreshTrigger: number;
  onActionComplete: () => void;
  initialFilter?: 'all' | 'active' | 'inactive';
}

const PppoeSecretsTable = ({ refreshTrigger, onActionComplete, initialFilter = 'all' }: PppoeSecretsTableProps) => {
  const { pppoeSecrets, selectedDeviceId } = useMikrotik() || { pppoeSecrets: [], selectedDeviceId: null };
  const [allSecrets, setAllSecrets] = useState<PppoeSecret[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [secretToDelete, setSecretToDelete] = useState<PppoeSecret | null>(null);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [secretToEdit, setSecretToEdit] = useState<PppoeSecret | null>(null);
  const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;

  // Update secrets dari WebSocket data (sama seperti summary aktif)
  useEffect(() => {
    if (!selectedDeviceId) {
      setAllSecrets([]);
      setLoading(false);
      return;
    }
    
    // Gunakan data WebSocket untuk tabel (sama seperti summary aktif)
    const secretsArray = Array.isArray(pppoeSecrets) ? pppoeSecrets : [];
    
    // Transform secrets dari WebSocket ke format yang diharapkan
    // Data sudah di-enrich di backend dengan isActive, uptime, currentAddress, activeConnectionId
    const transformedSecrets: PppoeSecret[] = secretsArray.map((secret: any) => {
      const secretData: PppoeSecret = {
        '.id': secret['.id'] || '',
        name: secret.name || '',
        profile: secret.profile || '',
        'remote-address': secret.currentAddress || secret['remote-address'] || null,
        disabled: secret.disabled || 'false',
        isActive: secret.isActive === true,
        activeConnectionId: secret.activeConnectionId || undefined
      };
      return secretData;
    });
    
    setAllSecrets(transformedSecrets);
    setLoading(false);
    
    const activeCount = transformedSecrets.filter(s => s.isActive).length;
    console.log('[PppoeSecretsTable] Update secrets dari WebSocket:', {
      total: transformedSecrets.length,
      active: activeCount
    });
  }, [pppoeSecrets, selectedDeviceId, refreshTrigger]);

  // Map untuk lookup uptime dari secrets yang aktif
  const secretsUptimeMap = useMemo(() => {
    const map = new Map();
    pppoeSecrets?.forEach((secret: any) => {
      if (secret.name && secret.isActive && secret.uptime) {
        map.set(secret.name, secret.uptime);
      }
    });
    return map;
  }, [pppoeSecrets]);
  
  // Fungsi untuk menentukan apakah secret aktif
  const isSecretActive = useCallback((secret: PppoeSecret): boolean => {
    return secret.isActive === true;
  }, []);
  
  // Fungsi untuk mendapatkan uptime dari secret
  const getUptime = useCallback((secretName: string): string | null => {
    return secretsUptimeMap.get(secretName) || null;
  }, [secretsUptimeMap]);
  
  const handleSort = (column: string) => {
    if (sortColumn === column) {
      // Toggle direction jika kolom yang sama diklik
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      // Set kolom baru dan default ke asc
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

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
    
    // Apply sorting
    if (sortColumn) {
      filtered = [...filtered].sort((a, b) => {
        let aValue: any;
        let bValue: any;
        
        switch (sortColumn) {
          case 'status':
            // Sort by: disabled first, then active/inactive
            const aDisabled = a.disabled === 'true' ? 0 : (isSecretActive(a) ? 1 : 2);
            const bDisabled = b.disabled === 'true' ? 0 : (isSecretActive(b) ? 1 : 2);
            aValue = aDisabled;
            bValue = bDisabled;
            break;
          case 'name':
            aValue = a.name.toLowerCase();
            bValue = b.name.toLowerCase();
            break;
          case 'profile':
            aValue = a.profile.toLowerCase();
            bValue = b.profile.toLowerCase();
            break;
          case 'remote-address':
            const aAddr = a['remote-address'] || '';
            const bAddr = b['remote-address'] || '';
            // Sort empty values last
            if (!aAddr && !bAddr) {
              aValue = 0;
              bValue = 0;
            } else if (!aAddr) {
              aValue = Infinity; // Empty values go last
              bValue = 0;
            } else if (!bAddr) {
              aValue = 0;
              bValue = Infinity; // Empty values go last
            } else {
              // Parse IP address untuk sorting numerik
              const parseIP = (ip: string): number => {
                // Split IP address menjadi array of numbers
                const parts = ip.split('.').map(part => parseInt(part, 10) || 0);
                // Pad dengan 0 jika kurang dari 4 bagian (untuk IPv4)
                while (parts.length < 4) parts.push(0);
                // Convert ke single number untuk comparison (setiap bagian max 255)
                // Format: part1 * 256^3 + part2 * 256^2 + part3 * 256 + part4
                return parts[0] * 16777216 + parts[1] * 65536 + parts[2] * 256 + parts[3];
              };
              
              // Check if it's a valid IP address format (contains dots and numbers)
              const isIPFormat = (str: string) => /^\d+\.\d+\.\d+\.\d+$/.test(str);
              
              if (isIPFormat(aAddr) && isIPFormat(bAddr)) {
                // Both are IP addresses, compare numerically
                aValue = parseIP(aAddr);
                bValue = parseIP(bAddr);
              } else {
                // Not IP addresses, compare as strings
                aValue = aAddr.toLowerCase();
                bValue = bAddr.toLowerCase();
              }
            }
            break;
          case 'uptime':
            const aUptime = getUptime(a.name);
            const bUptime = getUptime(b.name);
            // Parse uptime string to seconds for comparison
            // Format MikroTik: "1w2d3h4m5s" (w=week, d=day, h=hour, m=minute, s=second)
            const parseUptime = (uptime: string | null): number => {
              if (!uptime || uptime === 'N/A' || uptime === '...') return 0;
              
              // Match patterns: w (week), d (day), h (hour), m (minute), s (second)
              const weekMatch = uptime.match(/(\d+)w/);
              const dayMatch = uptime.match(/(\d+)d/);
              const hourMatch = uptime.match(/(\d+)h/);
              const minuteMatch = uptime.match(/(\d+)m/);
              const secondMatch = uptime.match(/(\d+)s/);
              
              let totalSeconds = 0;
              if (weekMatch) totalSeconds += parseInt(weekMatch[1]) * 7 * 24 * 60 * 60;
              if (dayMatch) totalSeconds += parseInt(dayMatch[1]) * 24 * 60 * 60;
              if (hourMatch) totalSeconds += parseInt(hourMatch[1]) * 60 * 60;
              if (minuteMatch) totalSeconds += parseInt(minuteMatch[1]) * 60;
              if (secondMatch) totalSeconds += parseInt(secondMatch[1]);
              
              return totalSeconds;
            };
            aValue = parseUptime(aUptime);
            bValue = parseUptime(bUptime);
            break;
          default:
            return 0;
        }
        
        if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
        return 0;
      });
    }
    
    return filtered;
  }, [allSecrets, isSecretActive, initialFilter, searchQuery, sortColumn, sortDirection, getUptime]);
  
  const handleAction = async (action: 'enable' | 'disable' | 'kick', secret: PppoeSecret) => {
    setIsActionLoading(true);
    
    try {
        if (action === 'kick') {
            // Untuk kick, kita perlu .id dari /ppp/active/print
            // Data sudah di-enrich di backend dengan activeConnectionId
            if (!isSecretActive(secret)) {
                throw new Error("User tidak aktif, tidak bisa di-kick.");
            }
            
            // Gunakan activeConnectionId yang sudah ada di secret (dari WebSocket data)
            if (!secret.activeConnectionId) {
                throw new Error("ID koneksi aktif tidak ditemukan. Silakan refresh halaman.");
            }
            
            try {
                const encodedId = encodeURIComponent(secret.activeConnectionId);
                const res = await apiFetch(`${apiUrl}/api/pppoe/active/${encodedId}/kick`, {
                    method: 'POST'
                });
                if(!res.ok) {
                    const errData = await res.json();
                    throw new Error(errData.message || "Aksi gagal");
                }
            } catch (error: any) {
                throw new Error(error.message || "Gagal melakukan kick");
            }
        } else if (action === 'disable') {
            // Jika disable, kick user terlebih dahulu jika sedang aktif
            // Note: Untuk kick, kita perlu .id dari /ppp/active/print
            // Tapi karena data sudah merged, kita skip kick dan langsung disable
            // User akan terputus otomatis saat secret di-disable
            if (isSecretActive(secret)) {
                console.log('User aktif akan terputus otomatis saat secret di-disable');
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
                  <th 
                    className="p-4 font-semibold cursor-pointer hover:bg-secondary/80 transition-colors select-none"
                    onClick={() => handleSort('status')}
                  >
                    <div className="flex items-center gap-2">
                      Status
                      {sortColumn === 'status' ? (
                        sortDirection === 'asc' ? <ChevronUp size={16} /> : <ChevronDown size={16} />
                      ) : (
                        <ArrowUpDown size={16} className="text-muted-foreground opacity-50" />
                      )}
                    </div>
                  </th>
                  <th 
                    className="p-4 font-semibold cursor-pointer hover:bg-secondary/80 transition-colors select-none"
                    onClick={() => handleSort('name')}
                  >
                    <div className="flex items-center gap-2">
                      Nama
                      {sortColumn === 'name' ? (
                        sortDirection === 'asc' ? <ChevronUp size={16} /> : <ChevronDown size={16} />
                      ) : (
                        <ArrowUpDown size={16} className="text-muted-foreground opacity-50" />
                      )}
                    </div>
                  </th>
                  <th 
                    className="p-4 font-semibold cursor-pointer hover:bg-secondary/80 transition-colors select-none"
                    onClick={() => handleSort('profile')}
                  >
                    <div className="flex items-center gap-2">
                      Profil
                      {sortColumn === 'profile' ? (
                        sortDirection === 'asc' ? <ChevronUp size={16} /> : <ChevronDown size={16} />
                      ) : (
                        <ArrowUpDown size={16} className="text-muted-foreground opacity-50" />
                      )}
                    </div>
                  </th>
                  <th 
                    className="p-4 font-semibold cursor-pointer hover:bg-secondary/80 transition-colors select-none"
                    onClick={() => handleSort('remote-address')}
                  >
                    <div className="flex items-center gap-2">
                      Remote Address
                      {sortColumn === 'remote-address' ? (
                        sortDirection === 'asc' ? <ChevronUp size={16} /> : <ChevronDown size={16} />
                      ) : (
                        <ArrowUpDown size={16} className="text-muted-foreground opacity-50" />
                      )}
                    </div>
                  </th>
                  <th 
                    className="p-4 font-semibold cursor-pointer hover:bg-secondary/80 transition-colors select-none"
                    onClick={() => handleSort('uptime')}
                  >
                    <div className="flex items-center gap-2">
                      Uptime
                      {sortColumn === 'uptime' ? (
                        sortDirection === 'asc' ? <ChevronUp size={16} /> : <ChevronDown size={16} />
                      ) : (
                        <ArrowUpDown size={16} className="text-muted-foreground opacity-50" />
                      )}
                    </div>
                  </th>
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
                      // Gunakan kombinasi .id dan name untuk key yang unik
                      // Jika .id tidak ada, gunakan name sebagai fallback (name harus unik)
                      const uniqueKey = user['.id'] || `secret-${user.name}-${i}`;
                      return (
                        <motion.tr key={uniqueKey} className="border-b" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.05 }}>
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
                            {formatUptime(uptime)}
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