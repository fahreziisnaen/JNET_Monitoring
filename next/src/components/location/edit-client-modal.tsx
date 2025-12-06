'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from '@/components/motion';
import { X, User, Loader2, MapPin, Unlink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiFetch } from '@/utils/api';
import { Client } from './client-list';
import { Asset } from './asset-list';

interface EditClientModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  client: Client | null;
  assets?: Asset[];
}

const EditClientModal = ({ isOpen, onClose, onSuccess, client, assets = [] }: EditClientModalProps) => {
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [odpAssetId, setOdpAssetId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;

  // Filter assets untuk hanya ODP
  const odpAssets = assets.filter(a => a.type === 'ODP');

  useEffect(() => {
    if (client && isOpen) {
      setLatitude(client.latitude.toString());
      setLongitude(client.longitude.toString());
      setOdpAssetId(client.odp_asset_id?.toString() || '');
      setError('');
    }
  }, [client, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!client) return;

    if (!latitude || !longitude) {
      setError('Koordinat wajib diisi.');
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
      const res = await apiFetch(`${apiUrl}/api/clients/${client.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          latitude: lat,
          longitude: lon,
          odp_asset_id: odpAssetId ? parseInt(odpAssetId) : null,
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Gagal mengupdate client.");
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Gagal mengupdate client.');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || !client) return null;

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
                <User /> Edit Client
              </h2>
              <button type="button" onClick={onClose} className="p-1 rounded-full hover:bg-secondary">
                <X size={20} />
              </button>
            </header>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">PPPoE Secret</label>
                <Input
                  value={client.pppoe_secret_name}
                  disabled
                  className="bg-secondary"
                />
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
                {client.odp_name && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Saat ini terhubung ke: <span className="font-semibold">{client.odp_name}</span>
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
              <Button type="submit" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>}
                Simpan Perubahan
              </Button>
            </footer>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default EditClientModal;

