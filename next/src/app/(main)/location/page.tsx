'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import dynamic from 'next/dynamic';
import { Plus, Upload, Loader2, RefreshCw, User, Download } from 'lucide-react';
import AssetList, { Asset } from '@/components/location/asset-list';
import ClientList, { Client } from '@/components/location/client-list';
import AddAssetModal from '@/components/location/add-asset-modal';
import AssetDetailModal from '@/components/location/asset-detail-modal';
import EditAssetModal from '@/components/location/edit-asset-modal';
import ConfirmModal from '@/components/ui/confirm-modal';
import AddConnectionModal from '@/components/location/add-connection-modal';
import AddClientModal from '@/components/location/add-client-modal';
import EditClientModal from '@/components/location/edit-client-modal';
import ClientDetailModal from '@/components/location/client-detail-modal';
import { Button } from '@/components/ui/button';
import { assetTypes } from '@/components/location/asset-filter';
import MapLegend from '@/components/location/map-legend';
import MapFilterPanel from '@/components/location/map-filter-panel';
import { apiFetch, getAuthToken } from '@/utils/api';

const MapDisplay = dynamic(() => import('@/components/location/map-display'), { 
  ssr: false, 
  loading: () => <div className="flex items-center justify-center h-full w-full bg-secondary rounded-xl"><p>Memuat Peta...</p></div> 
});

const LocationPage = () => {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  
  const [visibleTypes, setVisibleTypes] = useState<Set<string>>(
    new Set(assetTypes.map(t => t.id))
  );
  const [visibleOwners, setVisibleOwners] = useState<Set<string>>(new Set());
  const [showLines, setShowLines] = useState(true);
  const [showClients, setShowClients] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [clientSearchQuery, setClientSearchQuery] = useState('');

  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isAddConnectionModalOpen, setIsAddConnectionModalOpen] = useState(false);
  const [isAddClientModalOpen, setIsAddClientModalOpen] = useState(false);
  const [isClientDetailModalOpen, setIsClientDetailModalOpen] = useState(false);
  const [isEditClientModalOpen, setIsEditClientModalOpen] = useState(false);
  const [isDeleteClientModalOpen, setIsDeleteClientModalOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchAssets = useCallback(async () => {
    setLoading(true);
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
      const res = await apiFetch(`${apiUrl}/api/assets`);
      if (!res.ok) {
        console.error('[Location Page] Response tidak OK:', res.status);
        setAssets([]); // Set empty array jika error
        return;
      }
      const data = await res.json();
      // Pastikan data adalah array, jika tidak set ke empty array
      setAssets(Array.isArray(data) ? data : []);
    } catch (error) { 
      console.error('[Location Page] Error fetching assets:', error);
      setAssets([]); // Set empty array jika error
    } finally { 
      setLoading(false); 
    }
  }, []);

  const fetchClients = useCallback(async () => {
    setClientsLoading(true);
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
      const res = await apiFetch(`${apiUrl}/api/clients`);
      if (!res.ok) {
        console.error('[Location Page] Response tidak OK untuk clients:', res.status);
        setClients([]);
        return;
      }
      const data = await res.json();
      setClients(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('[Location Page] Error fetching clients:', error);
      setClients([]);
    } finally {
      setClientsLoading(false);
    }
  }, []);

  useEffect(() => { 
    fetchAssets(); 
    fetchClients();
  }, [fetchAssets, fetchClients, refreshTrigger]);

  // Get unique owners from assets
  const availableOwners = useMemo(() => {
    const owners = new Set<string>();
    assets.forEach(asset => {
      if (asset.owner_name && asset.owner_name.trim()) {
        owners.add(asset.owner_name);
      }
    });
    return Array.from(owners).sort();
  }, [assets]);

  // Set default visibleOwners to all owners when availableOwners changes
  useEffect(() => {
    if (availableOwners.length > 0 && visibleOwners.size === 0) {
      setVisibleOwners(new Set(availableOwners));
    }
  }, [availableOwners.length]); // Only depend on length to avoid infinite loop

  const filteredAssets = useMemo(() => {
    // Check if all owners are selected
    const allOwnersSelected = availableOwners.length > 0 && visibleOwners.size === availableOwners.length;
    
    return assets.filter(asset => {
      const typeMatch = visibleTypes.has(asset.type);
      // If all owners are selected, show all assets (including those without owner)
      // If not all owners selected, show only assets whose owner is in visibleOwners
      // Assets without owner_name are always shown
      const ownerMatch = allOwnersSelected || !asset.owner_name || visibleOwners.has(asset.owner_name);
      return typeMatch && ownerMatch;
    });
  }, [assets, visibleTypes, visibleOwners, availableOwners]);

  // Filter clients berdasarkan owner ODP yang terhubung
  const filteredClients = useMemo(() => {
    // Check if all owners are selected
    const allOwnersSelected = availableOwners.length > 0 && visibleOwners.size === availableOwners.length;
    
    return clients.filter(client => {
      // Jika client tidak terhubung ke ODP, selalu tampilkan
      if (!client.odp_asset_id || !client.odp_owner_name) {
        return true;
      }
      
      // Jika semua owner dipilih, tampilkan semua client
      if (allOwnersSelected) {
        return true;
      }
      
      // Tampilkan client jika owner ODP-nya terlihat
      return visibleOwners.has(client.odp_owner_name);
    });
  }, [clients, visibleOwners, availableOwners]);

  const handleToggleType = (type: string) => {
    setVisibleTypes(prev => {
      const newSet = new Set(prev);
      if (newSet.has(type)) {
        newSet.delete(type);
      } else {
        newSet.add(type);
      }
      return newSet;
    });
  };

  const handleToggleAll = () => {
    if (visibleTypes.size === assetTypes.length) {
      setVisibleTypes(new Set());
    } else {
      setVisibleTypes(new Set(assetTypes.map(t => t.id)));
    }
  };

  const handleToggleOwner = (owner: string) => {
    setVisibleOwners(prev => {
      const newSet = new Set(prev);
      if (newSet.has(owner)) {
        newSet.delete(owner);
      } else {
        newSet.add(owner);
      }
      return newSet;
    });
  };

  const handleToggleAllOwners = () => {
    if (visibleOwners.size === availableOwners.length) {
      setVisibleOwners(new Set());
    } else {
      setVisibleOwners(new Set(availableOwners));
    }
  };

  const handleSuccess = () => { 
    setRefreshTrigger(prev => prev + 1); 
  };

  const handleKmlUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    const formData = new FormData();
    formData.append('kmlFile', file);

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
      // FormData requires manual Authorization header
      const token = getAuthToken();
      const headers: HeadersInit = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      
      const res = await fetch(`${apiUrl}/api/import/kml`, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: formData,
      });
      if (!res.ok) throw new Error('Gagal mengimpor file KML.');
      handleSuccess();
    } catch (error) {
      console.error(error);
    } finally {
      setIsImporting(false);
      if(fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleKmlExport = async () => {
    setIsExporting(true);
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
      const token = getAuthToken();
      const headers: HeadersInit = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      
      const res = await fetch(`${apiUrl}/api/import/kml`, {
        method: 'GET',
        credentials: 'include',
        headers,
      });
      
      if (!res.ok) throw new Error('Gagal mengekspor file KML.');
      
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      a.download = `jnet-coverage-export-${timestamp}.kml`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error(error);
      alert('Gagal mengekspor file KML.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleAssetSelect = (asset: Asset) => {
    setSelectedAsset(asset);
    setIsDetailModalOpen(true);
  };

  const handleEdit = (asset: Asset) => {
    setSelectedAsset(asset);
    setIsDetailModalOpen(false);
    setIsEditModalOpen(true);
  };

  const handleDelete = (asset: Asset) => {
    setSelectedAsset(asset);
    setIsDetailModalOpen(false);
    setIsDeleteModalOpen(true);
  };

  const handleAddConnection = (asset: Asset) => {
    setSelectedAsset(asset);
    setIsDetailModalOpen(false);
    setIsAddConnectionModalOpen(true);
  };

  const handleClientSelect = (client: Client) => {
    setSelectedClient(client);
    setIsClientDetailModalOpen(true);
  };

  const handleEditClient = (client: Client) => {
    setSelectedClient(client);
    setIsClientDetailModalOpen(false);
    setIsEditClientModalOpen(true);
  };

  const handleDeleteClient = (client: Client) => {
    setSelectedClient(client);
    setIsDeleteClientModalOpen(true);
  };

  const handleDeleteClientConfirm = async () => {
    if (!selectedClient) return;
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
      await apiFetch(`${apiUrl}/api/clients/${selectedClient.id}`, {
        method: 'DELETE',
      });
      handleSuccess();
    } catch (error) {
      console.error(error);
    } finally {
      setIsDeleteClientModalOpen(false);
      setSelectedClient(null);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!selectedAsset) return;
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
      await apiFetch(`${apiUrl}/api/assets/${selectedAsset.id}`, {
        method: 'DELETE',
      });
      handleSuccess();
    } catch (error) {
      console.error(error);
    } finally {
      setIsDeleteModalOpen(false);
      setSelectedAsset(null);
    }
  };


  return (
    <>
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleKmlUpload} 
        className="hidden" 
        accept=".kml"
      />

      <div className="h-full flex flex-col p-4 md:p-6 lg:p-8">
        <div className="flex-shrink-0 mb-6">
            <div className="flex justify-between items-center flex-wrap gap-4">
              <h1 className="text-3xl font-bold text-foreground">Peta Lokasi Aset</h1>
              <div className="flex gap-2">
                <Button 
                  variant="outline" 
                  onClick={() => fetchAssets()} 
                  disabled={loading}
                >
                  {loading ? <Loader2 size={18} className="mr-2 animate-spin"/> : <RefreshCw size={18} className="mr-2"/>}
                  Refresh
                </Button>
                <Button variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={isImporting}>
                    {isImporting ? <Loader2 size={18} className="mr-2 animate-spin"/> : <Upload size={18} className="mr-2"/>}
                    Import KML
                </Button>
                <Button variant="outline" onClick={handleKmlExport} disabled={isExporting}>
                    {isExporting ? <Loader2 size={18} className="mr-2 animate-spin"/> : <Download size={18} className="mr-2"/>}
                    Backup KML
                </Button>
                <Button variant="outline" onClick={() => setIsAddClientModalOpen(true)}>
                  <User size={18} className="mr-2"/> Tambah Client
                </Button>
                <Button onClick={() => setIsAddModalOpen(true)}><Plus size={18} className="mr-2"/> Tambah Aset</Button>
              </div>
            </div>
        </div>
        
        <div className="flex-grow grid grid-cols-1 lg:grid-cols-5 gap-6 min-h-0">
          <div className="lg:col-span-2 min-h-[600px] lg:min-h-[calc(100vh-200px)] flex flex-col gap-4">
            <div className="flex-1 min-h-0">
              <AssetList 
                assets={filteredAssets} 
                loading={loading} 
                selectedAssetId={selectedAsset?.id} 
                onAssetSelect={handleAssetSelect}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
              />
            </div>
            <div className="flex-1 min-h-0">
              <ClientList
                clients={filteredClients}
                loading={clientsLoading}
                selectedClientId={selectedClient?.id}
                onClientSelect={handleClientSelect}
                searchQuery={clientSearchQuery}
                onSearchChange={setClientSearchQuery}
              />
            </div>
          </div>
          <div className="lg:col-span-3 min-h-[600px] lg:min-h-[calc(100vh-200px)] relative z-10">
            <MapDisplay 
              assets={filteredAssets} 
              clients={showClients ? filteredClients : []}
              onMarkerClick={handleAssetSelect}
              onClientClick={handleClientSelect}
              showLines={showLines}
              visibleTypes={visibleTypes}
              showClients={showClients}
              selectedAssetId={selectedAsset?.id}
              selectedClientId={selectedClient?.id}
            />
            <MapLegend />
            <MapFilterPanel
              visibleTypes={visibleTypes}
              onTypeToggle={handleToggleType}
              showLines={showLines}
              onToggleLines={setShowLines}
              onToggleAll={handleToggleAll}
              visibleOwners={visibleOwners}
              availableOwners={availableOwners}
              onOwnerToggle={handleToggleOwner}
              onToggleAllOwners={handleToggleAllOwners}
              showClients={showClients}
              onToggleClients={setShowClients}
            />
          </div>
        </div>
      </div>

      <AddAssetModal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} onSuccess={handleSuccess} />

      {selectedAsset && (
        <>
          <AssetDetailModal 
            isOpen={isDetailModalOpen} 
            onClose={() => setIsDetailModalOpen(false)} 
            asset={selectedAsset}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onAddConnection={handleAddConnection}
          />
          <EditAssetModal 
            isOpen={isEditModalOpen} 
            onClose={() => setIsEditModalOpen(false)} 
            assetToEdit={selectedAsset} 
            onSuccess={handleSuccess}
          />
          <AddConnectionModal
            isOpen={isAddConnectionModalOpen}
            onClose={() => setIsAddConnectionModalOpen(false)}
            asset={selectedAsset}
            onSuccess={handleSuccess}
          />
          <ConfirmModal
            isOpen={isDeleteModalOpen}
            onClose={() => setIsDeleteModalOpen(false)}
            onConfirm={handleDeleteConfirm}
            title={`Hapus Aset: ${selectedAsset.name}?`}
            description="Tindakan ini tidak dapat diurungkan. Semua koneksi pengguna yang terhubung ke aset ini akan ikut terhapus."
          />
        </>
      )}

      <AddClientModal 
        isOpen={isAddClientModalOpen} 
        onClose={() => setIsAddClientModalOpen(false)} 
        onSuccess={handleSuccess}
        assets={assets}
      />

      {selectedClient && (
        <>
          <ClientDetailModal
            isOpen={isClientDetailModalOpen}
            onClose={() => setIsClientDetailModalOpen(false)}
            client={selectedClient}
            onEdit={handleEditClient}
            onDelete={handleDeleteClient}
          />
          <EditClientModal
            isOpen={isEditClientModalOpen}
            onClose={() => setIsEditClientModalOpen(false)}
            onSuccess={handleSuccess}
            client={selectedClient}
            assets={assets}
          />
          <ConfirmModal
            isOpen={isDeleteClientModalOpen}
            onClose={() => setIsDeleteClientModalOpen(false)}
            onConfirm={handleDeleteClientConfirm}
            title={`Hapus Client: ${selectedClient.pppoe_secret_name}?`}
            description="Tindakan ini tidak dapat diurungkan. Client akan dihapus dari map dan koneksi ke ODP akan diputus."
          />
        </>
      )}

    </>
  );
};

export default LocationPage;