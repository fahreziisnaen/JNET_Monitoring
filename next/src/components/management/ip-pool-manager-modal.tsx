'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from '@/components/motion';
import { X, Save, Trash2, Database, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMikrotik } from '@/components/providers/mikrotik-provider';
import { apiFetch } from '@/utils/api';

interface IpPool {
  id: number;
  profile_name: string;
  ip_start: string;
  ip_end: string;
  gateway: string;
}

interface IpPoolManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const IpPoolManagerModal = ({ isOpen, onClose }: IpPoolManagerModalProps) => {
  const { selectedDeviceId } = useMikrotik() || { selectedDeviceId: null };
  const [pools, setPools] = useState<IpPool[]>([]);
  const [profiles, setProfiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  const [formData, setFormData] = useState({ profile_name: '', gateway: '', ip_start: '', ip_end: '' });

  const fetchData = async (skipAutoSync = false) => {
    setLoading(true);
    setError('');
    try {
      const [poolsRes, profilesRes] = await Promise.all([
        apiFetch(`${apiUrl}/api/ip-pools`),
        apiFetch(`${apiUrl}/api/pppoe/profiles`)
      ]);
      if (!poolsRes.ok || !profilesRes.ok) throw new Error("Gagal memuat data.");
      const poolsResponse = await poolsRes.json();
      const profilesData = await profilesRes.json();
      
      // Handle response format baru (dengan pools dan isEmpty) atau format lama (array langsung)
      let poolsData: IpPool[];
      
      if (Array.isArray(poolsResponse)) {
        // Format lama: array langsung (backward compatibility)
        poolsData = poolsResponse;
      } else {
        // Format baru: object dengan pools dan isEmpty
        poolsData = poolsResponse.pools || [];
      }
      
      // Cek apakah database benar-benar kosong
      const isEmpty = poolsData.length === 0;
      
      console.log('[IP Pool] Data loaded:', { 
        poolsCount: poolsData.length, 
        isEmpty, 
        skipAutoSync,
        responseType: Array.isArray(poolsResponse) ? 'array' : 'object',
        willSync: isEmpty && !skipAutoSync,
        poolsData: poolsData.length > 0 ? poolsData.map(p => p.profile_name) : 'empty'
      });
      
      // Pastikan profiles terurut (untuk safety, meskipun backend sudah sort)
      const sortedProfiles = [...profilesData].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
      
      // Jika database kosong (tidak ada data) dan belum skip auto sync, lakukan sync otomatis
      // Hanya sync jika benar-benar tidak ada data di database (poolsData.length === 0)
      if (poolsData.length === 0 && !skipAutoSync) {
        console.log('[IP Pool] Database kosong, melakukan sync otomatis...');
        console.log('[IP Pool] Database kosong, melakukan sync otomatis...');
        try {
          const syncUrl = selectedDeviceId 
            ? `${apiUrl}/api/ip-pools/sync?deviceId=${selectedDeviceId}`
            : `${apiUrl}/api/ip-pools/sync`;
          
          const syncRes = await apiFetch(syncUrl, {
            method: 'POST'
          });
          
          if (syncRes.ok) {
            // Setelah sync berhasil, fetch ulang data
            const [newPoolsRes] = await Promise.all([
              apiFetch(`${apiUrl}/api/ip-pools`)
            ]);
            if (newPoolsRes.ok) {
              const newPoolsResponse = await newPoolsRes.json();
              const newPoolsData = Array.isArray(newPoolsResponse) ? newPoolsResponse : newPoolsResponse.pools || [];
              setPools(newPoolsData);
              setProfiles(sortedProfiles);
              
              // Update form dengan data yang baru di-sync
              if (newPoolsData.length > 0 && sortedProfiles.length > 0) {
                const firstProfile = sortedProfiles[0];
                const existingPool = newPoolsData.find((pool: IpPool) => pool.profile_name === firstProfile);
                if (existingPool) {
                  setFormData({
                    profile_name: firstProfile,
                    ip_start: existingPool.ip_start,
                    ip_end: existingPool.ip_end,
                    gateway: existingPool.gateway
                  });
                } else {
                  setFormData({
                    profile_name: firstProfile,
                    ip_start: '',
                    ip_end: '',
                    gateway: ''
                  });
                }
              }
              return; // Exit early setelah sync otomatis
            }
          }
        } catch (syncError: any) {
          console.warn('[IP Pool] Sync otomatis gagal:', syncError.message);
          // Tetap lanjutkan dengan data kosong jika sync gagal
        }
      }
      
      // Jika sudah ada data atau sync otomatis tidak dilakukan, gunakan data yang ada
      setPools(poolsData);
      setProfiles(sortedProfiles);
      
      // Setelah pools di-set, update form berdasarkan profile yang dipilih
      setFormData(prev => {
        const currentProfile = prev.profile_name || (sortedProfiles.length > 0 ? sortedProfiles[0] : '');
        
        if (currentProfile) {
          const existingPool = poolsData.find((pool: IpPool) => pool.profile_name === currentProfile);
          if (existingPool) {
            // Jika ada pool untuk profile ini, isi form dengan data pool tersebut
            return {
              profile_name: currentProfile,
              ip_start: existingPool.ip_start,
              ip_end: existingPool.ip_end,
              gateway: existingPool.gateway
            };
          } else {
            // Jika tidak ada pool, tetap gunakan profile yang dipilih tapi reset field lainnya
            return {
              profile_name: currentProfile,
              ip_start: '',
              ip_end: '',
              gateway: ''
            };
          }
        } else if (sortedProfiles.length > 0) {
          // Jika belum ada profile yang dipilih, pilih profile pertama
          const firstProfile = sortedProfiles[0];
          const existingPool = poolsData.find((pool: IpPool) => pool.profile_name === firstProfile);
          if (existingPool) {
            return {
              profile_name: firstProfile,
              ip_start: existingPool.ip_start,
              ip_end: existingPool.ip_end,
              gateway: existingPool.gateway
            };
          } else {
            return {
              profile_name: firstProfile,
              ip_start: '',
              ip_end: '',
              gateway: ''
            };
      }
        }
        
        return prev;
      });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  
  useEffect(() => {
    if (isOpen) fetchData();
  }, [isOpen]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    
    // Jika profile_name berubah, cari data pool yang sudah ada untuk profile tersebut
    if (name === 'profile_name') {
      const existingPool = pools.find(pool => pool.profile_name === value);
      if (existingPool) {
        // Jika ada pool yang sudah ada, isi form dengan data tersebut
        setFormData({
          profile_name: value,
          ip_start: existingPool.ip_start,
          ip_end: existingPool.ip_end,
          gateway: existingPool.gateway
        });
      } else {
        // Jika tidak ada, reset form dengan profile baru saja
        setFormData(prev => ({
          ...prev,
          profile_name: value,
          ip_start: '',
          ip_end: '',
          gateway: ''
        }));
      }
    } else {
      // Untuk field lain, update seperti biasa
      setFormData(prev => ({...prev, [name]: value}));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch(`${apiUrl}/api/ip-pools`, {
        method: 'POST',
        body: JSON.stringify(formData)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      
      // Setelah submit berhasil, refresh data dan update form dengan data yang baru disimpan
      const [poolsRes] = await Promise.all([
        apiFetch(`${apiUrl}/api/ip-pools`)
      ]);
      if (poolsRes.ok) {
        const poolsResponse = await poolsRes.json();
        const poolsData = Array.isArray(poolsResponse) ? poolsResponse : poolsResponse.pools || [];
        setPools(poolsData);
        
        // Update form dengan data yang baru saja disimpan
        const savedPool = poolsData.find((pool: IpPool) => pool.profile_name === formData.profile_name);
        if (savedPool) {
          setFormData({
            profile_name: savedPool.profile_name,
            ip_start: savedPool.ip_start,
            ip_end: savedPool.ip_end,
            gateway: savedPool.gateway
          });
        }
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (poolId: number) => {
    if (!window.confirm("Yakin ingin menghapus aturan IP Pool ini?")) return;
    setLoading(true);
    try {
        await apiFetch(`${apiUrl}/api/ip-pools/${poolId}`, { method: 'DELETE' });
        fetchData();
    } catch (err) {
        setError("Gagal menghapus pool.");
    } finally {
        setLoading(false);
    }
  };

  const handleSyncFromMikrotik = async () => {
    if (!window.confirm("Ini akan mengimpor IP Pool dari Mikrotik dan mengupdate yang sudah ada. Lanjutkan?")) return;
    setLoading(true);
    setError('');
    try {
      // Kirim deviceId jika ada untuk optimasi
      const syncUrl = selectedDeviceId 
        ? `${apiUrl}/api/ip-pools/sync?deviceId=${selectedDeviceId}`
        : `${apiUrl}/api/ip-pools/sync`;
      
      const res = await apiFetch(syncUrl, {
        method: 'POST'
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Gagal sinkronisasi');
      alert(data.message || 'Sinkronisasi berhasil!');
      // Skip auto sync karena ini adalah sync manual
      fetchData(true);
    } catch (err: any) {
      setError(err.message || 'Gagal sinkronisasi IP Pool dari Mikrotik.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/70 flex items-center justify-center z-[1001] p-4" onClick={onClose}>
          <motion.div initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 50, opacity: 0 }} transition={{ type: 'spring', damping: 20, stiffness: 300 }} className="bg-card text-card-foreground rounded-2xl shadow-2xl w-full max-w-2xl border flex flex-col max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <header className="flex-shrink-0 flex justify-between items-center p-4 border-b"><h2 className="text-xl font-bold flex items-center gap-2"><Database/> Manajer IP Pool</h2><button type="button" onClick={onClose} className="p-1 rounded-full hover:bg-secondary"><X size={20} /></button></header>
            <div className="flex-grow p-6 space-y-4 overflow-y-auto">
                <div className="flex justify-between items-center">
                  <h3 className="font-semibold text-muted-foreground">Aturan Aktif</h3>
                  <Button 
                    onClick={handleSyncFromMikrotik} 
                    variant="outline" 
                    size="sm" 
                    disabled={loading}
                    className="flex items-center gap-2"
                  >
                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                    Sync dari Mikrotik
                  </Button>
                </div>
                {loading ? <div className="flex justify-center p-4"><Loader2 className="animate-spin"/></div> : pools.length > 0 ? <div className="space-y-2">{pools.map(pool => (<div key={pool.id} className="text-sm p-3 bg-secondary rounded-lg flex justify-between items-center"><div><p className="font-bold text-primary">{pool.profile_name}</p><p className="text-xs font-mono text-muted-foreground">Range: {pool.ip_start} - {pool.ip_end}</p><p className="text-xs font-mono text-muted-foreground">Gateway: {pool.gateway}</p></div><Button onClick={() => handleDelete(pool.id)} variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive"><Trash2 size={16}/></Button></div>))}</div> : <p className="text-center text-muted-foreground text-sm">Belum ada aturan IP Pool yang dibuat.</p>}
            </div>
            <form onSubmit={handleSubmit}>
              <div className="flex-shrink-0 p-6 border-t space-y-4 bg-background">
                  <h3 className="font-semibold">Tambah/Update Aturan Baru</h3>
                  {error && <p className="text-sm text-destructive text-center p-2 bg-destructive/10 rounded-md">{error}</p>}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div><label className="text-sm font-medium">Profil PPPoE</label><select name="profile_name" value={formData.profile_name} onChange={handleChange} className="w-full p-2 mt-1 rounded-md bg-input" required>{profiles.map(p => <option key={p} value={p}>{p}</option>)}</select></div>
                      <div><label className="text-sm font-medium">Gateway (Local)</label><input name="gateway" value={formData.gateway} onChange={handleChange} type="text" placeholder="e.g., 10.10.10.1" className="w-full p-2 mt-1 rounded-md bg-input" required /></div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div><label className="text-sm font-medium">IP Start (Remote)</label><input name="ip_start" value={formData.ip_start} onChange={handleChange} type="text" placeholder="e.g., 10.10.10.2" className="w-full p-2 mt-1 rounded-md bg-input" required /></div>
                      <div><label className="text-sm font-medium">IP End (Remote)</label><input name="ip_end" value={formData.ip_end} onChange={handleChange} type="text" placeholder="e.g., 10.10.10.254" className="w-full p-2 mt-1 rounded-md bg-input" required /></div>
                  </div>
                  <div className="flex justify-end"><Button type="submit" className="flex items-center gap-2" disabled={loading}>{loading && <Loader2 className="animate-spin h-4 w-4 mr-2"/>}<Save size={16} /> Simpan Aturan</Button></div>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
export default IpPoolManagerModal;