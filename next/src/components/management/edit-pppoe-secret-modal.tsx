'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from '@/components/motion';
import { X, Edit, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMikrotik } from '@/components/providers/mikrotik-provider';
import { useAuth } from '@/components/providers/auth-provider';
import { apiFetch } from '@/utils/api';

interface EditPppoeSecretModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  secretToEdit: any | null;
  nocWorkspaceId?: number; // Added to handle cross-workspace editing from NOC
}

const EditPppoeSecretModal = ({ isOpen, onClose, onSuccess, secretToEdit, nocWorkspaceId }: EditPppoeSecretModalProps) => {
  const { pppoeSecrets } = useMikrotik() || { pppoeSecrets: [] };
  const [formData, setFormData] = useState({ name: '', password: '', profile: '' });
  const [profiles, setProfiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [profilesLoading, setProfilesLoading] = useState(false);
  const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;

  // Cache key berbasis workspaceId target (per workspace device yang diedit, bukan workspace user yang login)
  const { user } = useAuth();
  // workspaceId dari secretToEdit (NOC) atau dari props nocWorkspaceId, atau dari user sendiri
  const targetWorkspaceId = secretToEdit?.workspace_id || nocWorkspaceId || user?.workspace_id || 'default';
  const targetDeviceId = secretToEdit?.deviceId;
  const profilesCacheKey = `pppoe-profiles-ws-${targetWorkspaceId}-dev-${targetDeviceId || 'all'}`;
  const CACHE_TTL = 5 * 60 * 1000; // 5 menit cache

  // Load profiles dengan caching
  const loadProfiles = async () => {
    // Cek cache dulu
    try {
      const cached = localStorage.getItem(profilesCacheKey);
      if (cached) {
        const { data, timestamp } = JSON.parse(cached);
        const now = Date.now();
        if (now - timestamp < CACHE_TTL) {
          const sortedData = Array.from(new Set<string>((data as string[]).filter((p) => Boolean(p && p.trim())))).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
          setProfiles(sortedData);
          return;
        }
      }
    } catch (e) {
      // Ignore cache error
    }

    // Fetch dari API - kirim workspaceId target agar backend mengambil profile dari workspace yang tepat
    setProfilesLoading(true);
    try {
      let queryParams = targetWorkspaceId ? `?workspaceId=${targetWorkspaceId}` : '';
      if (targetDeviceId) {
        queryParams += queryParams ? `&deviceId=${targetDeviceId}` : `?deviceId=${targetDeviceId}`;
      }
      const res = await apiFetch(`${apiUrl}/api/pppoe/profiles${queryParams}`);
      if (!res.ok) throw new Error('Gagal memuat profil');
      const data = await res.json();
      const sortedData = Array.from(new Set<string>((data as string[]).filter((p) => Boolean(p && p.trim())))).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
      setProfiles(sortedData);

      // Simpan ke cache
      try {
        localStorage.setItem(profilesCacheKey, JSON.stringify({
          data,
          timestamp: Date.now()
        }));
      } catch (e) {
        // Ignore cache save error
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setProfilesLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && secretToEdit) {
      setFormData({ name: secretToEdit.name || '', password: '', profile: secretToEdit.profile });
      loadProfiles();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, secretToEdit]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!secretToEdit) return;
    setLoading(true);
    setError('');
    try {
      // Cek apakah profile berubah
      const profileChanged = formData.profile !== secretToEdit.profile;

      let queryParams = nocWorkspaceId ? `?workspaceId=${nocWorkspaceId}` : '';
      if (secretToEdit.deviceId) {
        queryParams += queryParams ? `&deviceId=${secretToEdit.deviceId}` : `?deviceId=${secretToEdit.deviceId}`;
      }

      // Update secret terlebih dahulu
      const res = await apiFetch(`${apiUrl}/api/pppoe/secrets/${encodeURIComponent(secretToEdit.name)}${queryParams}`, {
        method: 'PUT',
        body: JSON.stringify(formData)
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Gagal mengupdate secret");
      }

      // Jika profile berubah dan user sedang aktif, kick user setelah update
      if (profileChanged) {
        // Gunakan activeConnectionId dari secretToEdit (jika ada) atau cari dari pppoeSecrets
        let activeConnectionId = (secretToEdit as any)?.activeConnectionId;
        if (!activeConnectionId) {
          // Fallback: cari dari pppoeSecrets
          const updatedSecret = pppoeSecrets.find((s: any) => s.name === secretToEdit.name && s.isActive === true);
          activeConnectionId = updatedSecret?.activeConnectionId;
        }

        if (activeConnectionId) {
          try {
            const encodedId = encodeURIComponent(activeConnectionId);
            const kickRes = await apiFetch(`${apiUrl}/api/pppoe/active/${encodedId}/kick${queryParams}`, {
              method: 'POST'
            });
            if (!kickRes.ok) {
              const kickData = await kickRes.json();
              console.warn('Gagal kick user setelah update profile:', kickData.message);
              // Tetap sukses karena secret sudah di-update
            }
          } catch (kickErr: any) {
            console.warn('Error saat kick user setelah update profile:', kickErr.message);
            // Tetap sukses karena secret sudah di-update
          }
        } else {
          console.warn('User tidak aktif atau activeConnectionId tidak ditemukan, skip kick');
        }
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!secretToEdit) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/70 flex items-center justify-center z-[1001] p-4" onClick={onClose}>
          <motion.div initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 50, opacity: 0 }} transition={{ type: 'spring', damping: 20, stiffness: 300 }} className="bg-card rounded-2xl shadow-2xl w-full max-w-lg border" onClick={(e) => e.stopPropagation()}>
            <form onSubmit={handleSubmit}>
              <header className="flex justify-between items-center p-4 border-b"><h2 className="text-xl font-bold flex items-center gap-2"><Edit /> Edit Secret: {secretToEdit.name}</h2><button type="button" onClick={onClose} className="p-1 rounded-full hover:bg-secondary"><X size={20} /></button></header>
              <div className="p-6 space-y-4">
                <div><label className="block text-sm font-medium mb-1 text-muted-foreground">Username / Nama Secret</label><input type="text" name="name" value={formData.name} onChange={handleChange} className="w-full p-2 rounded-md bg-input" required /></div>
                <div><label className="block text-sm font-medium mb-1 text-muted-foreground">Password Baru (kosongkan jika tidak diubah)</label><input type="password" name="password" onChange={handleChange} className="w-full p-2 rounded-md bg-input" /></div>
                <div>
                  <label className="block text-sm font-medium mb-1 text-muted-foreground">Profil Kecepatan</label>
                  {profilesLoading ? (
                    <div className="w-full p-2 rounded-md bg-input flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-sm text-muted-foreground">Memuat profil...</span>
                    </div>
                  ) : (
                    <select name="profile" value={formData.profile} onChange={handleChange} className="w-full p-2 rounded-md bg-input" required>
                      {profiles.length > 0 ? (
                        profiles.map((p, i) => <option key={`profile-${p}-${i}`} value={p}>{p}</option>)
                      ) : (
                        <option value="">Tidak ada profil tersedia</option>
                      )}
                    </select>
                  )}
                </div>
                {error && <p className="text-sm text-destructive text-center">{error}</p>}
              </div>
              <footer className="flex justify-end gap-4 p-4 bg-secondary/50"><Button type="button" variant="ghost" onClick={onClose}>Batal</Button><Button type="submit" disabled={loading}>{loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Simpan Perubahan</Button></footer>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
export default EditPppoeSecretModal;