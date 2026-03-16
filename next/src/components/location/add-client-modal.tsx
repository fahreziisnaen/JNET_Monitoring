'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from '@/components/motion';
import { X, User, Loader2, MapPin, Unlink, Camera, Image as ImageIcon, Search, ChevronDown, Server } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiFetch } from '@/utils/api';
import { useAuth } from '@/components/providers/auth-provider';
import { Asset } from './asset-list';

interface PppoeSecret {
  name: string;
  connected_odp_id?: number;
  [key: string]: any;
}

interface Device {
  id: number;
  name: string;
  host: string;
}

interface AddClientModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  assets?: Asset[];
  nocWorkspaceId?: number;
}

const AddClientModal = ({ isOpen, onClose, onSuccess, assets = [] }: AddClientModalProps) => {
  const { user } = useAuth();

  // Device selection
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<number | null>(null);
  const [devicesLoading, setDevicesLoading] = useState(false);

  // PPPoE secrets from selected device
  const [allSecrets, setAllSecrets] = useState<PppoeSecret[]>([]);
  const [secretsLoading, setSecretsLoading] = useState(false);

  const [existingClients, setExistingClients] = useState<string[]>([]);
  const [odpConnections, setOdpConnections] = useState<Map<string, number>>(new Map());
  const [selectedSecret, setSelectedSecret] = useState('');
  const [clientName, setClientName] = useState('');
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [odpAssetId, setOdpAssetId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedPhoto, setSelectedPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [odpSearchQuery, setOdpSearchQuery] = useState('');
  const [isOdpDropdownOpen, setIsOdpDropdownOpen] = useState(false);
  const odpDropdownRef = React.useRef<HTMLDivElement>(null);
  const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;

  // Filter assets untuk hanya ODP
  const odpAssets = assets.filter(a => a.type === 'ODP');

  // Fetch devices saat modal dibuka
  useEffect(() => {
    if (isOpen && user?.workspace_id) {
      setDevicesLoading(true);
      apiFetch(`${apiUrl}/api/devices`)
        .then(res => res.ok ? res.json() : [])
        .then((data: Device[]) => {
          setDevices(Array.isArray(data) ? data : []);
          // Auto-select first device if only one exists
          if (Array.isArray(data) && data.length === 1) {
            setSelectedDeviceId(data[0].id);
          }
        })
        .catch(() => setDevices([]))
        .finally(() => setDevicesLoading(false));
    }
  }, [isOpen, user?.workspace_id, apiUrl]);

  // Reset form saat modal dibuka
  useEffect(() => {
    if (isOpen && user?.workspace_id) {
      setError('');
      setSelectedSecret('');
      setClientName('');
      setWhatsappNumber('');
      setLatitude('');
      setLongitude('');
      setOdpAssetId('');
      setSelectedPhoto(null);
      setPhotoPreview(null);
      setAllSecrets([]);
      // Reset device selection if more than 1 device
      // (single device auto-select handled in devices fetch effect)

      // Fetch existing clients sekali, lalu build kedua data dari hasilnya
      setLoading(true);
      apiFetch(`${apiUrl}/api/clients`)
        .then(res => {
          if (!res.ok) throw new Error('Gagal memuat data client.');
          return res.json();
        })
        .then(clients => {
          const clientNames = clients.map((c: any) => c.pppoe_secret_name);
          const connectionsMap = new Map<string, number>();
          clients.forEach((client: any) => {
            if (client.odp_asset_id && client.pppoe_secret_name) {
              connectionsMap.set(client.pppoe_secret_name, client.odp_asset_id);
            }
          });
          setExistingClients(clientNames);
          setOdpConnections(connectionsMap);
        })
        .catch(() => setError("Gagal memuat data client."))
        .finally(() => setLoading(false));
    }
  }, [isOpen, apiUrl, user?.workspace_id]);

  // Fetch PPPoE secrets saat device dipilih
  useEffect(() => {
    if (!selectedDeviceId) {
      setAllSecrets([]);
      setSelectedSecret('');
      return;
    }

    setSecretsLoading(true);
    setSelectedSecret('');
    apiFetch(`${apiUrl}/api/pppoe/secrets?deviceId=${selectedDeviceId}`)
      .then(res => res.ok ? res.json() : { secrets: [] })
      .then(data => {
        const secrets = Array.isArray(data.secrets) ? data.secrets : (Array.isArray(data) ? data : []);
        setAllSecrets(secrets);
      })
      .catch(() => setAllSecrets([]))
      .finally(() => setSecretsLoading(false));
  }, [selectedDeviceId, apiUrl]);

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

  // Handle ESC key to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Filter unlinked secrets (belum jadi client)
  const unlinkedSecrets = useMemo(() => {
    if (!selectedDeviceId || allSecrets.length === 0) return [];
    const secretsArray = Array.isArray(allSecrets) ? allSecrets : [];
    const existingClientsSet = new Set(existingClients);

    return secretsArray
      .filter((secret: any) => secret.name && !existingClientsSet.has(secret.name))
      .map((secret: any) => ({
        name: secret.name || '',
        connected_odp_id: odpConnections.get(secret.name)
      } as PppoeSecret))
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  }, [allSecrets, selectedDeviceId, existingClients, odpConnections]);

  // Auto-select first secret saat secrets tersedia
  useEffect(() => {
    if (unlinkedSecrets.length > 0) {
      const isSelectedStillValid = unlinkedSecrets.some(s => s.name === selectedSecret);
      if (!selectedSecret || !isSelectedStillValid) {
        const first = unlinkedSecrets[0];
        setSelectedSecret(first.name);
        setOdpAssetId(first.connected_odp_id ? first.connected_odp_id.toString() : '');
      }
    } else if (unlinkedSecrets.length === 0 && !secretsLoading && selectedDeviceId) {
      setError("Semua PPPoE secrets sudah menjadi client atau tidak ada secret di device ini.");
    } else {
      setError('');
    }
  }, [unlinkedSecrets, secretsLoading, selectedDeviceId]);

  // Filter ODP assets based on search query
  const filteredOdpAssets = useMemo(() => {
    return odpAssets.filter(asset =>
      asset.name.toLowerCase().includes(odpSearchQuery.toLowerCase())
    );
  }, [odpAssets, odpSearchQuery]);

  const selectedOdp = useMemo(() => {
    return odpAssets.find(a => a.id.toString() === odpAssetId);
  }, [odpAssets, odpAssetId]);

  useEffect(() => {
    if (odpAssetId && !odpSearchQuery) {
      const selected = odpAssets.find(a => a.id.toString() === odpAssetId);
      if (selected) setOdpSearchQuery(selected.name);
    }
  }, [odpAssetId, odpAssets]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSecret || !latitude || !longitude || !selectedDeviceId) {
      setError('Semua field wajib diisi.');
      return;
    }

    const lat = parseFloat(latitude);
    const lon = parseFloat(longitude);
    if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      setError('Koordinat tidak valid. Silakan masukkan ulang.');
      setLatitude('');
      setLongitude('');
      return;
    }

    setLoading(true);
    setError('');

    const formDataToSubmit = new FormData();
    formDataToSubmit.append('pppoe_secret_name', selectedSecret);
    formDataToSubmit.append('device_id', selectedDeviceId.toString());
    if (clientName) formDataToSubmit.append('client_name', clientName);
    if (whatsappNumber) formDataToSubmit.append('whatsapp_number', whatsappNumber);
    formDataToSubmit.append('latitude', lat.toString());
    formDataToSubmit.append('longitude', lon.toString());
    if (odpAssetId) formDataToSubmit.append('odp_asset_id', odpAssetId);
    if (selectedPhoto) formDataToSubmit.append('photo', selectedPhoto);

    try {
      const res = await apiFetch(`${apiUrl}/api/clients`, {
        method: 'POST',
        body: formDataToSubmit
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

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      setSelectedPhoto(file);
      setPhotoPreview(URL.createObjectURL(file));
    }
  };
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) { setSelectedPhoto(file); setPhotoPreview(URL.createObjectURL(file)); }
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
            <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
              <p className="text-sm text-muted-foreground">
                Pilih MikroTik dan PPPoE secret, lalu masukkan koordinat untuk menampilkan client di map.
              </p>

              {/* Device Selector */}
              <div>
                <label className="block text-sm font-medium mb-2 flex items-center gap-2">
                  <Server size={14} /> Pilih MikroTik
                </label>
                {devicesLoading ? (
                  <div className="flex items-center gap-2 p-2 text-muted-foreground text-sm">
                    <Loader2 size={14} className="animate-spin" /> Memuat perangkat...
                  </div>
                ) : devices.length === 0 ? (
                  <p className="text-sm text-destructive">Tidak ada perangkat MikroTik terdaftar.</p>
                ) : (
                  <select
                    value={selectedDeviceId ?? ''}
                    onChange={e => setSelectedDeviceId(e.target.value ? parseInt(e.target.value) : null)}
                    className="w-full p-2 rounded-md bg-input border"
                    required
                  >
                    <option value="">-- Pilih MikroTik --</option>
                    {devices.map(d => (
                      <option key={d.id} value={d.id}>
                        {d.name} ({d.host})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* PPPoE Secret */}
              <div>
                <label htmlFor="pppoe-secret" className="block text-sm font-medium mb-2">PPPoE Secret</label>
                {secretsLoading ? (
                  <div className="flex items-center gap-2 p-2 text-muted-foreground text-sm">
                    <Loader2 size={14} className="animate-spin" /> Memuat secrets...
                  </div>
                ) : (
                  <select
                    id="pppoe-secret"
                    value={selectedSecret}
                    onChange={(e) => {
                      const secretName = e.target.value;
                      setSelectedSecret(secretName);
                      const secretData = unlinkedSecrets.find(s => s.name === secretName);
                      if (secretData?.connected_odp_id) {
                        setOdpAssetId(secretData.connected_odp_id.toString());
                      } else {
                        setOdpAssetId('');
                      }
                    }}
                    className="w-full p-2 rounded-md bg-input border"
                    disabled={loading || unlinkedSecrets.length === 0 || !selectedDeviceId}
                    required
                  >
                    {!selectedDeviceId && <option>Pilih MikroTik terlebih dahulu</option>}
                    {selectedDeviceId && unlinkedSecrets.length === 0 && !secretsLoading && (
                      <option>Tidak ada secret tersedia</option>
                    )}
                    {unlinkedSecrets.map(secret => (
                      <option key={secret.name} value={secret.name}>{secret.name}</option>
                    ))}
                  </select>
                )}
                {!selectedDeviceId && (
                  <p className="text-xs text-muted-foreground mt-1">Pilih MikroTik terlebih dahulu untuk melihat PPPoE secrets.</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="clientName" className="block text-sm font-medium mb-2 flex items-center gap-2">
                    <User size={14} /> Nama Client
                  </label>
                  <Input
                    id="clientName"
                    type="text"
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    placeholder="Contoh: Budi Santoso"
                    className="bg-input"
                  />
                </div>
                <div>
                  <label htmlFor="whatsappNumber" className="block text-sm font-medium mb-2 flex items-center gap-2">
                    <User size={14} /> Nomor Whatsapp
                  </label>
                  <Input
                    id="whatsappNumber"
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
                  <Input id="latitude" type="number" step="any" value={latitude} onChange={(e) => setLatitude(e.target.value)} placeholder="-7.821" className="bg-input" required />
                </div>
                <div>
                  <label htmlFor="longitude" className="block text-sm font-medium mb-2 flex items-center gap-2">
                    <MapPin size={14} /> Longitude
                  </label>
                  <Input id="longitude" type="number" step="any" value={longitude} onChange={(e) => setLongitude(e.target.value)} placeholder="112.016" className="bg-input" required />
                </div>
              </div>

              <div ref={odpDropdownRef} className="relative">
                <label htmlFor="odp-asset" className="block text-sm font-medium mb-2 flex items-center gap-2">
                  <Unlink size={14} /> Hubungkan ke ODP (Opsional)
                </label>
                <div className="relative">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground" size={16} />
                    <input
                      type="text"
                      value={odpSearchQuery}
                      onChange={(e) => {
                        setOdpSearchQuery(e.target.value);
                        setIsOdpDropdownOpen(true);
                        if (!e.target.value) setOdpAssetId('');
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
                        onClick={() => { setOdpAssetId(''); setOdpSearchQuery(''); setIsOdpDropdownOpen(false); }}
                      >
                        <span className="text-muted-foreground">Tidak terhubung ke ODP</span>
                      </div>
                      {filteredOdpAssets.length > 0 ? (
                        filteredOdpAssets.map((asset) => (
                          <div
                            key={asset.id}
                            className={`px-3 py-2 cursor-pointer hover:bg-secondary text-sm ${asset.id.toString() === odpAssetId ? 'bg-secondary' : ''}`}
                            onClick={() => { setOdpAssetId(asset.id.toString()); setOdpSearchQuery(asset.name); setIsOdpDropdownOpen(false); }}
                          >
                            <span className="font-medium">{asset.name}</span>
                          </div>
                        ))
                      ) : (
                        <div className="px-3 py-2 text-sm text-muted-foreground">Tidak ada ODP ditemukan</div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2 flex items-center gap-2">
                  <Camera size={14} /> Foto Client (Opsional)
                </label>
                <div className="space-y-3">
                  {photoPreview ? (
                    <div className="relative w-full aspect-video rounded-lg overflow-hidden bg-muted border group">
                      <img src={photoPreview} alt="Preview" className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => { setSelectedPhoto(null); setPhotoPreview(null); }}
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
                      onClick={() => document.getElementById('client-photo-upload')?.click()}
                      className={`w-full aspect-video rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-2 cursor-pointer transition-all ${isDragging ? 'border-primary bg-primary/10 scale-[1.02]' : 'border-muted-foreground/25 hover:bg-secondary/50'}`}
                    >
                      <ImageIcon className="text-muted-foreground opacity-50" size={32} />
                      <div className="text-center">
                        <p className="text-xs font-medium">Klik atau Drag &amp; Drop foto di sini</p>
                        <p className="text-[10px] text-muted-foreground">PNG, JPG up to 5MB</p>
                      </div>
                    </div>
                  )}
                  <input id="client-photo-upload" type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
                </div>
              </div>

              {error && (
                <p className="text-sm text-center text-destructive p-3 bg-destructive/10 rounded-md">{error}</p>
              )}
            </div>
            <footer className="flex justify-end gap-4 p-4 bg-secondary/50">
              <Button type="button" variant="ghost" onClick={onClose}>Batal</Button>
              <Button type="submit" disabled={loading || unlinkedSecrets.length === 0 || !selectedDeviceId}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
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
