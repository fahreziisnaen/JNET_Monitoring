'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from '@/components/motion';
import { X, User, Loader2, MapPin, Unlink, Camera, Image as ImageIcon, Search, ChevronDown } from 'lucide-react';
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
  const [clientName, setClientName] = useState('');
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [odpAssetId, setOdpAssetId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedPhoto, setSelectedPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [isPhotoDeleted, setIsPhotoDeleted] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isChangingOdp, setIsChangingOdp] = useState(false);
  const [odpSearchQuery, setOdpSearchQuery] = useState('');
  const [isOdpDropdownOpen, setIsOdpDropdownOpen] = useState(false);
  const odpDropdownRef = React.useRef<HTMLDivElement>(null);
  const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;

  // Filter assets untuk hanya ODP
  const odpAssets = assets.filter(a => a.type === 'ODP');

  useEffect(() => {
    if (client && isOpen) {
      setClientName(client.client_name || '');
      setWhatsappNumber(client.whatsapp_number || '');
      setLatitude(client.latitude.toString());
      setLongitude(client.longitude.toString());
      setOdpAssetId(client.odp_asset_id?.toString() || '');
      setPhotoPreview(client.photo_url ? `${apiUrl}${client.photo_url}` : null);
      setSelectedPhoto(null);
      setIsPhotoDeleted(false);
      setIsChangingOdp(false);
      setOdpSearchQuery(client.odp_name || '');
      setError('');
    }
  }, [client, isOpen]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (odpDropdownRef.current && !odpDropdownRef.current.contains(event.target as Node)) {
        setIsOdpDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
      setError('Koordinat tidak valid. Silakan masukkan ulang.');
      // Reset koordinat ke nilai awal dari client agar user bisa memasukkan ulang
      if (client) {
        setClientName(client.client_name || '');
        setWhatsappNumber(client.whatsapp_number || '');
        setLatitude(client.latitude.toString());
        setLongitude(client.longitude.toString());
      } else {
        setClientName('');
        setWhatsappNumber('');
        setLatitude('');
        setLongitude('');
      }
      return;
    }

    setLoading(true);
    setError('');

    const formDataToSubmit = new FormData();
    formDataToSubmit.append('pppoe_secret_name', client.pppoe_secret_name);
    if (clientName) formDataToSubmit.append('client_name', clientName);
    if (whatsappNumber) formDataToSubmit.append('whatsapp_number', whatsappNumber);
    formDataToSubmit.append('latitude', lat.toString());
    formDataToSubmit.append('longitude', lon.toString());
    formDataToSubmit.append('odp_asset_id', odpAssetId || '');

    if (selectedPhoto) {
      formDataToSubmit.append('photo', selectedPhoto);
    } else if (isPhotoDeleted) {
      formDataToSubmit.append('deletePhoto', 'true');
    }

    try {
      const res = await apiFetch(`${apiUrl}/api/clients/${client.id}`, {
        method: 'PUT',
        body: formDataToSubmit
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

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      setSelectedPhoto(file);
      setPhotoPreview(URL.createObjectURL(file));
      setIsPhotoDeleted(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedPhoto(file);
      setPhotoPreview(URL.createObjectURL(file));
      setIsPhotoDeleted(false);
    }
  };

  if (!isOpen || !client) return null;

  const filteredOdpAssets = odpAssets.filter(asset =>
    asset.name.toLowerCase().includes(odpSearchQuery.toLowerCase())
  );

  const selectedOdp = odpAssets.find(a => a.id.toString() === odpAssetId);

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
                  <label htmlFor="clientNameEdit" className="block text-sm font-medium mb-2 flex items-center gap-2">
                    <User size={14} /> Nama Client
                  </label>
                  <Input
                    id="clientNameEdit"
                    type="text"
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    placeholder="Contoh: Budi Santoso"
                    className="bg-input"
                  />
                </div>
                <div>
                  <label htmlFor="whatsappNumberEdit" className="block text-sm font-medium mb-2 flex items-center gap-2">
                    <User size={14} /> Nomor Whatsapp
                  </label>
                  <Input
                    id="whatsappNumberEdit"
                    type="text"
                    value={whatsappNumber}
                    onChange={(e) => setWhatsappNumber(e.target.value)}
                    placeholder="081234567890"
                    className="bg-input"
                  />
                </div>
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

              <div ref={odpDropdownRef} className="relative">
                <label htmlFor="odp-asset" className="block text-sm font-medium mb-2 flex items-center gap-2">
                  <Unlink size={14} /> Hubungkan ke ODP (Opsional)
                </label>
                {odpAssetId && !isChangingOdp ? (
                  <div className="flex items-center justify-between p-2 rounded-md bg-secondary/30 border">
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">
                        {selectedOdp ? selectedOdp.name : (client.odp_name || "Memuat...")}
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setIsChangingOdp(true)}
                      className="text-xs h-8"
                    >
                      Ganti ODP
                    </Button>
                  </div>
                ) : (
                  <div className="relative">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground" size={16} />
                      <input
                        type="text"
                        value={odpSearchQuery}
                        onChange={(e) => {
                          setOdpSearchQuery(e.target.value);
                          setIsOdpDropdownOpen(true);
                          if (!e.target.value) {
                            setOdpAssetId('');
                          }
                        }}
                        onFocus={() => setIsOdpDropdownOpen(true)}
                        placeholder={selectedOdp ? selectedOdp.name : "Cari ODP..."}
                        className="w-full p-2 pl-10 pr-10 rounded-md bg-input border"
                      />
                      <ChevronDown
                        className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground cursor-pointer"
                        size={16}
                        onClick={() => setIsOdpDropdownOpen(!isOdpDropdownOpen)}
                      />
                    </div>
                    {isOdpDropdownOpen && (
                      <div className="absolute z-50 w-full mt-1 bg-card border rounded-md shadow-lg max-h-60 overflow-y-auto">
                        <div
                          className="px-3 py-2 cursor-pointer hover:bg-secondary text-sm"
                          onClick={() => {
                            setOdpAssetId('');
                            setOdpSearchQuery('');
                            setIsOdpDropdownOpen(false);
                          }}
                        >
                          <span className="text-muted-foreground">Tidak terhubung ke ODP</span>
                        </div>
                        {filteredOdpAssets.length > 0 ? (
                          filteredOdpAssets.map((asset) => (
                            <div
                              key={asset.id}
                              className={`px-3 py-2 cursor-pointer hover:bg-secondary text-sm ${asset.id.toString() === odpAssetId ? 'bg-secondary' : ''}`}
                              onClick={() => {
                                setOdpAssetId(asset.id.toString());
                                setOdpSearchQuery(asset.name);
                                setIsOdpDropdownOpen(false);
                              }}
                            >
                              <span className="font-medium">{asset.name}</span>
                            </div>
                          ))
                        ) : (
                          <div className="px-3 py-2 text-sm text-muted-foreground">
                            Tidak ada ODP ditemukan
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {client.odp_name && !isChangingOdp && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Saat ini terhubung ke: <span className="font-semibold">{client.odp_name}</span>
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium mb-2 flex items-center gap-2">
                  <Camera size={14} /> Foto Client
                </label>
                <div className="space-y-3">
                  {photoPreview ? (
                    <div className="relative w-full aspect-video rounded-lg overflow-hidden bg-muted border group">
                      <img
                        src={photoPreview}
                        alt="Preview"
                        className="w-full h-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedPhoto(null);
                          setPhotoPreview(null);
                          setIsPhotoDeleted(true);
                        }}
                        className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-full hover:bg-red-600 shadow-lg"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <div
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                      onClick={() => document.getElementById('edit-client-photo-upload')?.click()}
                      className={`w-full aspect-video rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-2 cursor-pointer transition-all ${isDragging
                        ? 'border-primary bg-primary/10 scale-[1.02]'
                        : 'border-muted-foreground/25 hover:bg-secondary/50'
                        }`}
                    >
                      <ImageIcon className="text-muted-foreground opacity-50" size={32} />
                      <div className="text-center">
                        <p className="text-xs font-medium">Klik atau Drag & Drop foto baru di sini</p>
                        <p className="text-[10px] text-muted-foreground">PNG, JPG up to 5MB</p>
                      </div>
                    </div>
                  )}
                  <input
                    id="edit-client-photo-upload"
                    type="file"
                    accept="image/*"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </div>
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
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
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

