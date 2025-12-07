'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from '@/components/motion';
import { X, User, Loader2, MapPin, Unlink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiFetch } from '@/utils/api';
import { useMikrotik } from '@/components/providers/mikrotik-provider';
import { useAuth } from '@/components/providers/auth-provider';
import { Asset } from './asset-list';

interface PppoeSecret {
  name: string;
  connected_odp_id?: number;
  [key: string]: any;
}

interface AddClientModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  assets?: Asset[];
}

const AddClientModal = ({ isOpen, onClose, onSuccess, assets = [] }: AddClientModalProps) => {
  const { pppoeSecrets, selectedDeviceId } = useMikrotik() || {};
  const { user } = useAuth();
  const [existingClients, setExistingClients] = useState<string[]>([]);
  const [odpConnections, setOdpConnections] = useState<Map<string, number>>(new Map());
  const [selectedSecret, setSelectedSecret] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [odpAssetId, setOdpAssetId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;

  // Filter assets untuk hanya ODP
  const odpAssets = assets.filter(a => a.type === 'ODP');

  // Fetch existing clients dan ODP connections sekali saja saat modal dibuka
  useEffect(() => {
    if (isOpen && user?.workspace_id) {
      setLoading(true);
      setError('');
      setSelectedSecret('');
      setLatitude('');
      setLongitude('');
      setOdpAssetId('');
      
      // Fetch existing clients sekali, lalu build kedua data dari hasilnya
      apiFetch(`${apiUrl}/api/clients`)
        .then(res => {
          if (!res.ok) throw new Error('Gagal memuat data client.');
          return res.json();
        })
        .then(clients => {
          // Build existing clients list
          const clientNames = clients.map((c: any) => c.pppoe_secret_name);
          
          // Build ODP connections map dari clients yang punya odp_asset_id
          const connectionsMap = new Map<string, number>();
          clients.forEach((client: any) => {
            if (client.odp_asset_id && client.pppoe_secret_name) {
              connectionsMap.set(client.pppoe_secret_name, client.odp_asset_id);
            }
          });
          
          setExistingClients(clientNames);
          setOdpConnections(connectionsMap);
          setLoading(false);
        })
        .catch(() => {
          setError("Gagal memuat data client.");
          setLoading(false);
        });
    }
  }, [isOpen, apiUrl, user?.workspace_id]);

  // Filter unlinked secrets dari WebSocket data (sama seperti management page)
  const unlinkedSecrets = useMemo(() => {
    if (!pppoeSecrets || !selectedDeviceId) {
      return [];
    }

    const secretsArray = Array.isArray(pppoeSecrets) ? pppoeSecrets : [];
    const existingClientsSet = new Set(existingClients);

    // Filter secrets yang belum jadi client dan map dengan ODP connection
    return secretsArray
      .filter((secret: any) => secret.name && !existingClientsSet.has(secret.name))
      .map((secret: any) => {
        const secretData: PppoeSecret = {
          name: secret.name || '',
          connected_odp_id: odpConnections.get(secret.name)
        };
        return secretData;
      });
  }, [pppoeSecrets, selectedDeviceId, existingClients, odpConnections]);

  // Auto-select first secret saat secrets tersedia
  useEffect(() => {
    if (unlinkedSecrets.length > 0 && !selectedSecret) {
      const firstSecret = unlinkedSecrets[0];
      setSelectedSecret(firstSecret.name);
      if (firstSecret.connected_odp_id) {
        setOdpAssetId(firstSecret.connected_odp_id.toString());
      }
    } else if (unlinkedSecrets.length === 0 && !loading) {
      setError("Semua PPPoE secrets sudah menjadi client.");
    }
  }, [unlinkedSecrets, selectedSecret, loading]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSecret || !latitude || !longitude) {
      setError('Semua field wajib diisi.');
      return;
    }

    const lat = parseFloat(latitude);
    const lon = parseFloat(longitude);
    if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      setError('Koordinat tidak valid.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await apiFetch(`${apiUrl}/api/clients`, {
        method: 'POST',
        body: JSON.stringify({
          pppoe_secret_name: selectedSecret,
          latitude: lat,
          longitude: lon,
          odp_asset_id: odpAssetId ? parseInt(odpAssetId) : null,
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Gagal membuat client.");
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Gagal membuat client.');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div 
        initial={{ opacity: 0 }} 
        animate={{ opacity: 1 }} 
        exit={{ opacity: 0 }} 
        className="fixed inset-0 bg-black/70 flex items-center justify-center z-[1002] p-4" 
        onClick={onClose}
      >
        <motion.div 
          initial={{ y: 50, opacity: 0 }} 
          animate={{ y: 0, opacity: 1 }} 
          exit={{ y: 50, opacity: 0 }} 
          transition={{ type: 'spring' }} 
          className="bg-card text-card-foreground rounded-2xl shadow-2xl w-full max-w-md border" 
          onClick={e => e.stopPropagation()}
        >
          <form onSubmit={handleSubmit}>
            <header className="flex justify-between items-center p-4 border-b">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <User /> Tambah Client
              </h2>
              <button type="button" onClick={onClose} className="p-1 rounded-full hover:bg-secondary">
                <X size={20} />
              </button>
            </header>
            <div className="p-6 space-y-4">
              <p className="text-sm text-muted-foreground">
                Pilih PPPoE secret dari MikroTik dan masukkan koordinat untuk menampilkan client di map.
              </p>
              
              <div>
                <label htmlFor="pppoe-secret" className="block text-sm font-medium mb-2">PPPoE Secret</label>
                <select
                  id="pppoe-secret"
                  value={selectedSecret}
                  onChange={(e) => {
                    const secretName = e.target.value;
                    setSelectedSecret(secretName);
                    // Auto-select ODP jika PPPoE secret sudah terhubung ke ODP
                    const selectedSecretData = unlinkedSecrets.find(s => s.name === secretName);
                    if (selectedSecretData?.connected_odp_id) {
                      setOdpAssetId(selectedSecretData.connected_odp_id.toString());
                    } else {
                      setOdpAssetId('');
                    }
                  }}
                  className="w-full p-2 rounded-md bg-input border"
                  disabled={loading || unlinkedSecrets.length === 0 || !selectedDeviceId}
                  required
                >
                  {loading && <option>Memuat...</option>}
                  {!selectedDeviceId && !loading && <option>Pilih device terlebih dahulu</option>}
                  {unlinkedSecrets.length > 0 && unlinkedSecrets.map(secret => (
                    <option key={secret.name} value={secret.name}>{secret.name}</option>
                  ))}
                </select>
                {unlinkedSecrets.length === 0 && !loading && selectedDeviceId && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Semua PPPoE secrets sudah menjadi client.
                  </p>
                )}
                {!selectedDeviceId && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Pilih device MikroTik terlebih dahulu untuk melihat PPPoE secrets.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="latitude" className="block text-sm font-medium mb-2 flex items-center gap-2">
                    <MapPin size={14} /> Latitude
                  </label>
                  <Input
                    id="latitude"
                    type="number"
                    step="any"
                    value={latitude}
                    onChange={(e) => setLatitude(e.target.value)}
                    placeholder="-7.821"
                    className="bg-input"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="longitude" className="block text-sm font-medium mb-2 flex items-center gap-2">
                    <MapPin size={14} /> Longitude
                  </label>
                  <Input
                    id="longitude"
                    type="number"
                    step="any"
                    value={longitude}
                    onChange={(e) => setLongitude(e.target.value)}
                    placeholder="112.016"
                    className="bg-input"
                    required
                  />
                </div>
              </div>

              <div>
                <label htmlFor="odp-asset" className="block text-sm font-medium mb-2 flex items-center gap-2">
                  <Unlink size={14} /> Hubungkan ke ODP (Opsional)
                </label>
                <select
                  id="odp-asset"
                  value={odpAssetId}
                  onChange={(e) => setOdpAssetId(e.target.value)}
                  className="w-full p-2 rounded-md bg-input border"
                >
                  <option value="">Tidak terhubung ke ODP</option>
                  {odpAssets.map(asset => (
                    <option key={asset.id} value={asset.id.toString()}>
                      {asset.name}
                    </option>
                  ))}
                </select>
                {odpAssets.length === 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Belum ada ODP tersedia.
                  </p>
                )}
              </div>

              {error && (
                <p className="text-sm text-center text-destructive p-3 bg-destructive/10 rounded-md">
                  {error}
                </p>
              )}
            </div>
            <footer className="flex justify-end gap-4 p-4 bg-secondary/50">
              <Button type="button" variant="ghost" onClick={onClose}>
                Batal
              </Button>
              <Button type="submit" disabled={loading || unlinkedSecrets.length === 0 || !!error || !selectedDeviceId}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>}
                Simpan Client
              </Button>
            </footer>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default AddClientModal;

