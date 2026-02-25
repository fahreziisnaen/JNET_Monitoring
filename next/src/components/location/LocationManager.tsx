'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import dynamic from 'next/dynamic';
import { Plus, Upload, Loader2, RefreshCw, User, Download, GitBranch, Network } from 'lucide-react';
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
import { useMikrotik } from '@/components/providers/mikrotik-provider';
import { toast } from 'sonner';

const MapDisplay = dynamic(() => import('@/components/location/map-display'), {
  ssr: false,
  loading: () => <div className="flex items-center justify-center h-full w-full bg-secondary rounded-xl"><p>Memuat Peta...</p></div>
});

// Helper function to determine if asset is Up or Down
const isAssetUp = (asset: Asset): boolean => {
  // Check connection status
  if (asset.connection_status === 'putus') {
    return false; // Down
  }

  // For ODP, also check if all clients are down
  if (asset.type === 'ODP') {
    const activeUsers = asset.activeUsers || 0;
    const totalUsers = asset.totalUsers || 0;
    // If there are clients but all are down, it's Down
    if (totalUsers > 0 && activeUsers === 0) {
      return false; // Down
    }
  }

  // Up if connection_status is 'terpasang' (or other statuses like 'rencana', 'maintenance' are considered Up for now)
  return asset.connection_status === 'terpasang' ||
    asset.connection_status === 'rencana' ||
    asset.connection_status === 'maintenance' ||
    !asset.connection_status; // Default to Up if no status
};

interface LocationManagerProps {
  isNocMode?: boolean;
  nocWorkspaceIds?: number[];
}

const LocationManager: React.FC<LocationManagerProps> = ({ isNocMode = false, nocWorkspaceIds = [] }) => {
  const [activeFilter, setActiveFilter] = useState('all');
  const [selectedWorkspaceForNocAdd, setSelectedWorkspaceForNocAdd] = useState<number | null>(null);

  const { pppoeSecrets, isConnected } = useMikrotik() || { pppoeSecrets: [] };

  // Stabilize nocWorkspaceIds array — serialize to string to avoid new object reference on every render
  const nocWorkspaceIdsRef = useRef(nocWorkspaceIds);
  const nocWorkspaceIdsKey = nocWorkspaceIds.join(',');
  useEffect(() => {
    nocWorkspaceIdsRef.current = nocWorkspaceIds;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nocWorkspaceIdsKey]);

  const [isClientModalOpen, setIsClientModalOpen] = useState(false);
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
  const [showUp, setShowUp] = useState(true);
  const [showDown, setShowDown] = useState(true);
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

  // Path editing state
  const [isEditingPath, setIsEditingPath] = useState(false);
  const [editingPathPoints, setEditingPathPoints] = useState<[number, number][]>([]);
  const [pathTarget, setPathTarget] = useState<{ type: 'asset' | 'client', id: number } | null>(null);
  const [isPullingNewPoint, setIsPullingNewPoint] = useState(false);
  const [activeDraggedIndex, setActiveDraggedIndex] = useState<number | null>(null);
  // Undo history for path editing
  const [pathHistory, setPathHistory] = useState<[number, number][][]>([]);
  // Buffer (reactive) to preserve unsaved edits when switching between lines
  const [pendingPathEdits, setPendingPathEdits] = useState<Map<string, [number, number][]>>(new Map());
  // Pending marker moves (deferred, saved on Simpan)
  const [pendingMarkerMoves, setPendingMarkerMoves] = useState<Array<{ type: 'asset' | 'client'; id: number; lat: number; lng: number; origLat: number; origLng: number }>>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchAssetsAndClients = useCallback(async () => {
    const currentIds = nocWorkspaceIdsRef.current;
    if (isNocMode && currentIds.length === 0) {
      setAssets([]);
      setClients([]);
      setLoading(false);
      setClientsLoading(false);
      return;
    }

    setLoading(true);
    setClientsLoading(true);

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;

      if (isNocMode) {
        // Fetch aggregated Map data for NOC
        const res = await apiFetch(`${apiUrl}/api/noc/map`, {
          method: 'POST',
          body: JSON.stringify({ workspaceIds: currentIds })
        });
        if (!res.ok) throw new Error('Failed to fetch NOC map data');
        const data = await res.json();
        setAssets(Array.isArray(data.assets) ? data.assets : []);
        setClients(Array.isArray(data.clients) ? data.clients : []);
      } else {
        // Fetch single workspace Map data
        const [assetRes, clientRes] = await Promise.all([
          apiFetch(`${apiUrl}/api/assets`),
          apiFetch(`${apiUrl}/api/clients`)
        ]);

        if (assetRes.ok) {
          const assetData = await assetRes.json();
          setAssets(Array.isArray(assetData) ? assetData : []);
        } else {
          setAssets([]);
        }

        if (clientRes.ok) {
          const clientData = await clientRes.json();
          setClients(Array.isArray(clientData) ? clientData : []);
        } else {
          setClients([]);
        }
      }
    } catch (error) {
      console.error('[LocationManager] Error fetching map data:', error);
      setAssets([]);
      setClients([]);
    } finally {
      setLoading(false);
      setClientsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNocMode, nocWorkspaceIdsKey]);

  // isConnected sengaja TIDAK jadi trigger fetch — status koneksi hanya mempengaruhi rendering real-time,
  // bukan refetch database. Refetch dipicu oleh refreshTrigger (manual) dan nocWorkspaceIdsKey (perubahan workspace).
  useEffect(() => {
    fetchAssetsAndClients();
  }, [fetchAssetsAndClients, refreshTrigger]);

  // Derive real-time client status from pppoeSecrets
  const realTimeClientsBySecrets = useMemo(() => {
    // Check global disconnected status first
    if (!isConnected) {
      return []; // If the selected Mikrotik is offline, we instantly hide ALL tracked clients on this map view
    }

    if (!pppoeSecrets || pppoeSecrets.length === 0) return clients.filter(c => !c.isOffline); // Filter here too if no secrets

    // Create a map for fast lookup by name
    const secretMap = new Map(pppoeSecrets.map((s: any) => [s.name, s]));

    return clients.map(client => {
      const secret = secretMap.get(client.pppoe_secret_name) as any;
      return {
        ...client,
        isActive: secret ? secret.isActive : false
      };
    }).filter(c => !c.isOffline); // Automatically drop clients that are marked offline by the backend
  }, [clients, pppoeSecrets, isConnected]);

  // Derive real-time asset status (specifically for ODPs based on their connected clients)
  const realTimeAssetsBySecrets = useMemo(() => {
    return assets.map(asset => {
      if (asset.type !== 'ODP') return asset;

      // Look up clients connected to this ODP from our real-time client list
      const connectedClients = realTimeClientsBySecrets.filter(c => c.odp_asset_id === asset.id);

      return {
        ...asset,
        totalUsers: connectedClients.length,
        activeUsers: connectedClients.filter(c => c.isActive).length
      };
    });
  }, [assets, realTimeClientsBySecrets]);

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

  // Set default visibleOwners to all owners when availableOwners changes (first time only)
  const hasInitializedOwners = useRef(false);
  useEffect(() => {
    if (availableOwners.length > 0 && !hasInitializedOwners.current) {
      setVisibleOwners(new Set(availableOwners));
      hasInitializedOwners.current = true;
    }
  }, [availableOwners]);

  const filteredAssets = useMemo(() => {
    // Check if all owners are selected
    const allOwnersSelected = availableOwners.length > 0 && visibleOwners.size === availableOwners.length;

    return realTimeAssetsBySecrets.filter(asset => {
      const typeMatch = visibleTypes.has(asset.type);
      // If all owners are selected, show all assets (including those without owner)
      // If not all owners selected, show only assets whose owner is in visibleOwners
      // Assets without owner_name are always shown
      const ownerMatch = allOwnersSelected || !asset.owner_name || visibleOwners.has(asset.owner_name);

      // Status filter
      const isUp = isAssetUp(asset);
      const statusMatch = (isUp && showUp) || (!isUp && showDown);

      return typeMatch && ownerMatch && statusMatch;
    });
  }, [realTimeAssetsBySecrets, visibleTypes, visibleOwners, availableOwners, showUp, showDown]);

  const filteredClients = useMemo(() => {
    const allOwnersSelected = availableOwners.length === 0 ||
      (availableOwners.length > 0 && visibleOwners.size === availableOwners.length);

    const result = realTimeClientsBySecrets.filter(client => {
      let ownerMatch = true;
      if (client.odp_asset_id && client.odp_owner_name) {
        if (!allOwnersSelected && visibleOwners.size > 0) {
          ownerMatch = visibleOwners.has(client.odp_owner_name);
        }
      }
      const isClientUp = client.isActive === true;
      const statusMatch = (isClientUp && showUp) || (!isClientUp && showDown);
      return ownerMatch && statusMatch;
    });

    return result;
  }, [realTimeClientsBySecrets, visibleOwners, availableOwners, showUp, showDown]);

  // When in edit mode, overlay pending unsaved edits onto the displayed assets/clients
  // so all lines show their current (possibly unsaved) state visually.
  const displayAssets = useMemo(() => {
    if (!isEditingPath || pendingPathEdits.size === 0) return filteredAssets;
    return filteredAssets.map(asset => {
      const key = `asset-${asset.id}`;
      const pending = pendingPathEdits.get(key);
      if (pending) {
        return { ...asset, connection_path: JSON.stringify(pending) };
      }
      return asset;
    });
  }, [filteredAssets, isEditingPath, pendingPathEdits]);

  const displayClients = useMemo(() => {
    if (!isEditingPath || pendingPathEdits.size === 0) return filteredClients;
    return filteredClients.map(client => {
      const key = `client-${client.id}`;
      const pending = pendingPathEdits.get(key);
      if (pending) {
        return { ...client, connection_path: JSON.stringify(pending) };
      }
      return client;
    });
  }, [filteredClients, isEditingPath, pendingPathEdits]);

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
    const isAnythingChecked = visibleTypes.size > 0 ||
      (availableOwners.length > 0 && visibleOwners.size > 0) ||
      showLines || showClients || showUp || showDown;

    if (isAnythingChecked) {
      setVisibleTypes(new Set());
      setVisibleOwners(new Set());
      setShowLines(false);
      setShowClients(false);
      setShowUp(false);
      setShowDown(false);
    } else {
      setVisibleTypes(new Set(assetTypes.map(t => t.id)));
      setVisibleOwners(new Set(availableOwners));
      setShowLines(true);
      setShowClients(true);
      setShowUp(true);
      setShowDown(true);
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
    if (visibleOwners.size > 0) {
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
      toast.success("Import Berhasil", { description: "File KML berhasil diimpor." });
      handleSuccess();
    } catch (error) {
      console.error(error);
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
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
      toast.error("Gagal Ekspor KML", { description: "Terjadi kesalahan saat mengekspor file KML." });
    } finally {
      setIsExporting(false);
    }
  };

  const handleAssetSelect = (asset: Asset) => {
    // Hanya select asset, tidak buka modal
    setSelectedAsset(asset);
  };

  const handleAssetView = (asset: Asset) => {
    // Buka modal view asset
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
    // Hanya select client, tidak buka modal
    setSelectedClient(client);
  };

  const handleClientView = (client: Client) => {
    // Buka modal view client
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
      const wsParam = (isNocMode && selectedClient.workspace_id) ? `?workspaceId=${selectedClient.workspace_id}` : '';
      await apiFetch(`${apiUrl}/api/clients/${selectedClient.id}${wsParam}`, {
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
      const wsParam = (isNocMode && selectedAsset.workspace_id) ? `?workspaceId=${selectedAsset.workspace_id}` : '';
      await apiFetch(`${apiUrl}/api/assets/${selectedAsset.id}${wsParam}`, {
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

  const handleMarkerDragEnd = (type: 'asset' | 'client', id: number, lat: number, lng: number) => {
    // Get the current (original) coordinates before the optimistic update
    const origLat = type === 'asset'
      ? (assets.find(a => a.id === id)?.latitude ?? lat)
      : (clients.find(c => c.id === id)?.latitude ?? lat);
    const origLng = type === 'asset'
      ? (assets.find(a => a.id === id)?.longitude ?? lng)
      : (clients.find(c => c.id === id)?.longitude ?? lng);

    // Optimistic update — update local state immediately so the marker doesn't snap back
    if (type === 'asset') {
      setAssets(prev => prev.map(a => a.id === id ? { ...a, latitude: lat, longitude: lng } : a));
    } else {
      setClients(prev => prev.map(c => c.id === id ? { ...c, latitude: lat, longitude: lng } : c));
    }

    // --- Sync editingPathPoints if this marker is an endpoint of the active editing path ---
    // This prevents the orange overlay line from disconnecting when a connected marker is dragged.
    if (pathTarget && editingPathPoints.length >= 2) {
      // Case 1: The dragged marker IS the pathTarget (the "to" endpoint = last point)
      if (type === pathTarget.type && id === pathTarget.id) {
        setEditingPathPoints(prev => {
          if (prev.length < 2) return prev;
          const updated = [...prev];
          updated[updated.length - 1] = [lat, lng];
          return updated;
        });
      } else if (type === 'asset') {
        // Case 2: The dragged asset might be the "from" (parent) of the pathTarget (first point)
        const targetItem = pathTarget.type === 'asset'
          ? assets.find(a => a.id === pathTarget.id)
          : clients.find(c => c.id === pathTarget.id);
        const fromId = pathTarget.type === 'asset'
          ? (targetItem as Asset | undefined)?.parent_asset_id
          : (targetItem as Client | undefined)?.odp_asset_id;
        if (fromId && id === fromId) {
          setEditingPathPoints(prev => {
            if (prev.length < 2) return prev;
            const updated = [...prev];
            updated[0] = [lat, lng];
            return updated;
          });
        }
      }
    }
    // --- End sync editingPathPoints ---

    // Store as pending (deferred) move — will be saved when Simpan is clicked
    // If this marker was already moved, update the existing entry (keep the original origLat/origLng)
    setPendingMarkerMoves(prev => {
      const existingIdx = prev.findIndex(m => m.type === type && m.id === id);
      if (existingIdx >= 0) {
        // Update the destination but keep the original starting point
        const updated = [...prev];
        updated[existingIdx] = { ...updated[existingIdx], lat, lng };
        return updated;
      }
      return [...prev, { type, id, lat, lng, origLat, origLng }];
    });
  };

  const handleStartEditPath = (type: 'asset' | 'client', item: Asset | Client) => {
    setIsDetailModalOpen(false);
    setIsClientDetailModalOpen(false);
    setIsEditingPath(true);
    setPathTarget({ type, id: item.id });

    // Initialize with existing path or current connection
    if (item.connection_path) {
      try {
        const path = typeof item.connection_path === 'string'
          ? JSON.parse(item.connection_path)
          : item.connection_path;
        if (Array.isArray(path)) {
          setEditingPathPoints(path);
        }
      } catch (e) {
        setEditingPathPoints([]);
      }
    } else {
      // Find parent/ODP coordinates
      let fromCoords: [number, number] | null = null;
      if (type === 'asset') {
        const asset = item as Asset;
        if (asset.parent_asset_id) {
          const parent = realTimeAssetsBySecrets.find(a => a.id === asset.parent_asset_id);
          if (parent) fromCoords = [parent.latitude, parent.longitude];
        }
      } else {
        const client = item as Client;
        if (client.odp_asset_id) {
          const odp = realTimeAssetsBySecrets.find(a => a.id === client.odp_asset_id);
          if (odp) fromCoords = [odp.latitude, odp.longitude];
        }
      }

      if (fromCoords) {
        setEditingPathPoints([fromCoords, [item.latitude, item.longitude]]);
      } else {
        setEditingPathPoints([]);
      }
    }
  };

  // Helper: push current points to undo history
  const pushHistory = useCallback((points: [number, number][]) => {
    setPathHistory(prev => [...prev.slice(-20), points]); // Keep last 20 states
  }, []);

  const handleUndo = useCallback(() => {
    setPathHistory(prev => {
      if (prev.length === 0) return prev;
      const newHistory = [...prev];
      const previous = newHistory.pop()!;
      setEditingPathPoints(previous);
      return newHistory;
    });
  }, []);

  const handleMapClick = (latlng: [number, number]) => {
    if (!isEditingPath || editingPathPoints.length < 2) return;

    // Find nearest segment to insert into (instead of always before last point)
    let bestSegmentIdx = editingPathPoints.length - 1; // default: before last
    let bestDist = Infinity;

    for (let i = 0; i < editingPathPoints.length - 1; i++) {
      const a = editingPathPoints[i];
      const b = editingPathPoints[i + 1];
      // Project latlng onto segment a->b
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const lenSq = dx * dx + dy * dy;
      let t = lenSq > 0 ? ((latlng[0] - a[0]) * dx + (latlng[1] - a[1]) * dy) / lenSq : 0;
      t = Math.max(0, Math.min(1, t));
      const proj: [number, number] = [a[0] + t * dx, a[1] + t * dy];
      const distSq = (latlng[0] - proj[0]) ** 2 + (latlng[1] - proj[1]) ** 2;
      if (distSq < bestDist) {
        bestDist = distSq;
        bestSegmentIdx = i + 1; // insert after segment start
      }
    }

    pushHistory([...editingPathPoints]);
    const newPoints = [...editingPathPoints];
    newPoints.splice(bestSegmentIdx, 0, latlng);
    setEditingPathPoints(newPoints);
  };

  const handleLineClick = (type: 'asset' | 'client', id: number, latlng?: [number, number], fromMarker?: boolean) => {
    if (!isEditingPath) return;

    // Save current edits to buffer before switching target (reactive setState)
    if (pathTarget && !(pathTarget.type === type && pathTarget.id === id)) {
      const key = `${pathTarget.type}-${pathTarget.id}`;
      const currentPoints = [...editingPathPoints];
      setPendingPathEdits(prev => {
        const next = new Map(prev);
        next.set(key, currentPoints);
        return next;
      });
    }

    // Jika sudah memilih target yang sama dan bukan dari marker, tambahkan titik di lokasi klik jika ada latlng
    if (pathTarget && pathTarget.type === type && pathTarget.id === id && !fromMarker) {
      if (latlng && editingPathPoints.length >= 2) {
        pushHistory([...editingPathPoints]);

        // Cari segmen terdekat dari posisi klik (sama seperti handleMapClick)
        let bestSegmentIdx = editingPathPoints.length - 1;
        let bestDist = Infinity;
        for (let i = 0; i < editingPathPoints.length - 1; i++) {
          const a = editingPathPoints[i];
          const b = editingPathPoints[i + 1];
          const dx = b[0] - a[0], dy = b[1] - a[1];
          const lenSq = dx * dx + dy * dy;
          let t = lenSq > 0 ? ((latlng[0] - a[0]) * dx + (latlng[1] - a[1]) * dy) / lenSq : 0;
          t = Math.max(0, Math.min(1, t));
          const proj: [number, number] = [a[0] + t * dx, a[1] + t * dy];
          const distSq = (latlng[0] - proj[0]) ** 2 + (latlng[1] - proj[1]) ** 2;
          if (distSq < bestDist) {
            bestDist = distSq;
            bestSegmentIdx = i + 1;
          }
        }

        const newPoints = [...editingPathPoints];
        newPoints.splice(bestSegmentIdx, 0, latlng);
        setEditingPathPoints(newPoints);

        // Mulai tarik titik baru
        setIsPullingNewPoint(true);
        setActiveDraggedIndex(bestSegmentIdx);
      }
      return;
    }

    // Jika dari marker dan target sudah sama, tidak perlu melakukan apa-apa
    if (fromMarker && pathTarget && pathTarget.type === type && pathTarget.id === id) {
      return;
    }

    setPathTarget({ type, id });
    setPathHistory([]); // Clear undo history when switching target
    const item = type === 'asset'
      ? realTimeAssetsBySecrets.find(a => a.id === id)
      : realTimeClientsBySecrets.find(c => c.id === id);

    if (!item) return;

    // Check if we have pending (unsaved) edits for this target
    const pendingKey = `${type}-${id}`;
    const pending = pendingPathEdits.get(pendingKey);
    if (pending && pending.length >= 2) {
      setEditingPathPoints(pending);
      return;
    }

    // Initialize with existing path or current connection
    let points: [number, number][] = [];
    if (item.connection_path) {
      try {
        const path = typeof item.connection_path === 'string'
          ? JSON.parse(item.connection_path)
          : item.connection_path;
        if (Array.isArray(path)) {
          points = path;
        }
      } catch (e) {
        console.error('Error parsing path:', e);
      }
    }

    if (points.length >= 2) {
      // Fix for stale connection_path endpoints:
      // The DB stores the marker coordinates AT THE TIME THE PATH WAS SAVED.
      // If markers have been moved since, the first/last point will be stale.
      // Override them with the current live coordinates of from/to markers.
      let fromCoords: [number, number] | null = null;
      if (type === 'asset') {
        const assetItem = item as Asset;
        if (assetItem.parent_asset_id) {
          const parent = realTimeAssetsBySecrets.find(a => a.id === assetItem.parent_asset_id);
          if (parent) fromCoords = [parent.latitude, parent.longitude];
        }
      } else {
        const clientItem = item as Client;
        if (clientItem.odp_asset_id) {
          const odp = realTimeAssetsBySecrets.find(a => a.id === clientItem.odp_asset_id);
          if (odp) fromCoords = [odp.latitude, odp.longitude];
        }
      }
      if (fromCoords) points[0] = fromCoords;
      points[points.length - 1] = [Number(item.latitude), Number(item.longitude)];
    }

    if (points.length < 2) {
      // Default straight line if no path exists
      let fromCoords: [number, number] | null = null;
      if (type === 'asset') {
        const asset = item as Asset;
        if (asset.parent_asset_id) {
          const parent = realTimeAssetsBySecrets.find(a => a.id === asset.parent_asset_id);
          if (parent) fromCoords = [parent.latitude, parent.longitude];
        }
      } else {
        const client = item as Client;
        if (client.odp_asset_id) {
          const odp = realTimeAssetsBySecrets.find(a => a.id === client.odp_asset_id);
          if (odp) fromCoords = [odp.latitude, odp.longitude];
        }
      }

      if (fromCoords) {
        const startPoint: [number, number] = [Number(fromCoords[0]), Number(fromCoords[1])];
        const endPoint: [number, number] = [Number(item.latitude), Number(item.longitude)];

        if (!isNaN(startPoint[0]) && !isNaN(startPoint[1]) && !isNaN(endPoint[0]) && !isNaN(endPoint[1])) {
          const midPoint: [number, number] = latlng || [
            (startPoint[0] + endPoint[0]) / 2,
            (startPoint[1] + endPoint[1]) / 2
          ];
          points = [startPoint, midPoint, endPoint];

          // Hanya auto-pull point jika diklik dari garis (bukan dari ikon/marker)
          if (!fromMarker) {
            setIsPullingNewPoint(true);
            setActiveDraggedIndex(1);
          }
        } else {
          if (!isNaN(startPoint[0]) && !isNaN(endPoint[0])) {
            points = [startPoint, endPoint];
          }
        }
      }
    }

    // Final check for points to prevent NaN leaking to MapDisplay
    const validPoints = points.filter(p => Array.isArray(p) && !isNaN(Number(p[0])) && !isNaN(Number(p[1])));
    setEditingPathPoints(validPoints as [number, number][]);
  };

  const handleMouseUp = () => {
    setIsPullingNewPoint(false);
    setActiveDraggedIndex(null);
  };

  const handleWaypointDrag = (index: number, latlng: [number, number]) => {
    if (!isEditingPath) return;
    setEditingPathPoints(prev => {
      // Push to history only on first drag (before it changes)
      return prev.map((p, i) => i === index ? latlng : p) as [number, number][];
    });
  };

  const handleWaypointDragStart = useCallback((points: [number, number][], dragIdx?: number) => {
    pushHistory(points);
    // If dragging an existing waypoint, start the pull mechanism for that index
    if (dragIdx !== undefined) {
      setIsPullingNewPoint(true);
      setActiveDraggedIndex(dragIdx);
    }
  }, [pushHistory]);

  const handleSavePath = async () => {
    const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
    let failCount = 0;
    let totalSaved = 0;

    // --- Save path edits ---
    if (pathTarget) {
      const allSaves: Array<{ type: 'asset' | 'client', id: number, points: [number, number][], workspace_id?: number }> = [];

      const targetItem = pathTarget.type === 'asset'
        ? assets.find(a => a.id === pathTarget.id)
        : clients.find(c => c.id === pathTarget.id);

      allSaves.push({ type: pathTarget.type, id: pathTarget.id, points: editingPathPoints, workspace_id: targetItem?.workspace_id });

      pendingPathEdits.forEach((points, key) => {
        const [type, idStr] = key.split('-') as ['asset' | 'client', string];
        const id = parseInt(idStr);
        if (!(type === pathTarget.type && id === pathTarget.id)) {
          const pendingItem = type === 'asset'
            ? assets.find(a => a.id === id)
            : clients.find(c => c.id === id);
          allSaves.push({ type, id, points, workspace_id: pendingItem?.workspace_id });
        }
      });

      for (const save of allSaves) {
        const wsParam = (isNocMode && save.workspace_id) ? `?workspaceId=${save.workspace_id}` : '';
        const endpoint = save.type === 'asset'
          ? `${apiUrl}/api/assets/${save.id}${wsParam}`
          : `${apiUrl}/api/clients/${save.id}${wsParam}`;
        try {
          const res = await apiFetch(endpoint, {
            method: 'PUT',
            body: JSON.stringify({ connection_path: JSON.stringify(save.points) })
          });
          if (!res.ok) failCount++;
          else totalSaved++;
        } catch { failCount++; }
      }
    }

    // --- Save pending marker moves ---
    for (const move of pendingMarkerMoves) {
      const moveItem = move.type === 'asset'
        ? assets.find(a => a.id === move.id)
        : clients.find(c => c.id === move.id);

      const wsParam = (isNocMode && moveItem?.workspace_id) ? `?workspaceId=${moveItem.workspace_id}` : '';
      const endpoint = move.type === 'asset'
        ? `${apiUrl}/api/assets/${move.id}${wsParam}`
        : `${apiUrl}/api/clients/${move.id}${wsParam}`;
      try {
        const res = await apiFetch(endpoint, {
          method: 'PATCH',
          body: JSON.stringify({ latitude: move.lat, longitude: move.lng })
        });
        if (!res.ok) failCount++;
        else totalSaved++;
      } catch { failCount++; }
    }

    // --- Show result ---
    if (failCount > 0) {
      toast.warning("Penyimpanan Parsial", { description: `⚠️ ${failCount} item gagal disimpan.` });
    } else if (totalSaved > 0) {
      toast.success("Penyimpanan Berhasil", { description: `✅ ${totalSaved} perubahan berhasil disimpan!` });
    }

    // --- Reset all edit state ---
    setPendingPathEdits(new Map());
    setPendingMarkerMoves([]);
    setPathHistory([]);
    setIsEditingPath(false);
    setPathTarget(null);
    setEditingPathPoints([]);
    handleSuccess();
  };

  // Confirm Modal State
  const [confirmConfig, setConfirmConfig] = useState({
    isOpen: false,
    title: '',
    description: '',
    confirmText: 'Konfirmasi',
    action: async () => { }, // Placeholder
    isLoading: false
  });

  const openConfirm = (title: string, description: string, confirmText: string, action: () => Promise<void>) => {
    setConfirmConfig({
      isOpen: true,
      title,
      description,
      confirmText,
      action,
      isLoading: false
    });
  };

  const handleConfirmAction = async () => {
    setConfirmConfig(prev => ({ ...prev, isLoading: true }));
    try {
      await confirmConfig.action();
      setConfirmConfig(prev => ({ ...prev, isOpen: false }));
    } catch (error) {
      console.error(error);
    } finally {
      setConfirmConfig(prev => ({ ...prev, isLoading: false }));
    }
  };

  const handleResetPathClick = () => {
    if (!pathTarget) return;
    openConfirm(
      "Reset Jalur Konseksi",
      "Apakah Anda yakin ingin menghapus jalur kustom dan kembali ke garis lurus?",
      "Ya, Reset Jalur",
      handleResetPath
    );
  };

  const handleResetPath = async () => {
    if (!pathTarget) return;

    const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
    const endpoint = pathTarget.type === 'asset'
      ? `${apiUrl}/api/assets/${pathTarget.id}`
      : `${apiUrl}/api/clients/${pathTarget.id}`;

    try {
      const res = await apiFetch(endpoint, {
        method: 'PUT',
        body: JSON.stringify({
          connection_path: null
        })
      });

      if (!res.ok) throw new Error('Gagal mereset jalur.');
      setIsEditingPath(false);
      setPathTarget(null);
      setEditingPathPoints([]);
      handleSuccess();
      toast.success("Jalur Direset", { description: "Jalur koneksi berhasil dikembalikan ke default." });
    } catch (error) {
      toast.error("Gagal Reset", { description: "Gagal mereset jalur." });
    }
  };

  // --- Bulk Delete Handlers ---
  const [pendingBulkDelete, setPendingBulkDelete] = useState<{ type: 'asset' | 'client'; ids: number[] } | null>(null);

  const handleBulkDeleteAssets = (ids: number[]) => {
    setPendingBulkDelete({ type: 'asset', ids });
  };

  const handleBulkDeleteClients = (ids: number[]) => {
    setPendingBulkDelete({ type: 'client', ids });
  };

  const executeBulkDelete = async () => {
    if (!pendingBulkDelete) return;
    const { type, ids } = pendingBulkDelete;
    const endpoint = type === 'asset'
      ? `${process.env.NEXT_PUBLIC_API_BASE_URL}/api/assets/bulk`
      : `${process.env.NEXT_PUBLIC_API_BASE_URL}/api/clients/bulk`;
    try {
      const res = await apiFetch(endpoint, {
        method: 'DELETE',
        body: JSON.stringify({ ids })
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (type === 'asset') {
        setAssets(prev => prev.filter(a => !ids.includes(a.id)));
      } else {
        setClients(prev => prev.filter(c => !ids.includes(c.id)));
      }
      toast.success('Berhasil Dihapus', { description: data.message });
    } catch {
      toast.error('Gagal Menghapus', { description: 'Terjadi kesalahan saat menghapus data.' });
    } finally {
      setPendingBulkDelete(null);
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
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
              {isNocMode ? `Peta Agregasi NOC (${nocWorkspaceIds.length} Workspace)` : 'Peta Lokasi Aset'}
            </h1>
            <div className="flex gap-2 flex-wrap items-center">
              {!isNocMode && (
                <>
                  <Button variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={isImporting}>
                    {isImporting ? <Loader2 size={18} className="sm:mr-2 animate-spin" /> : <Upload size={18} className="sm:mr-2" />}
                    <span className="hidden sm:inline">Import KML</span>
                  </Button>
                  <Button variant="outline" onClick={handleKmlExport} disabled={isExporting}>
                    {isExporting ? <Loader2 size={18} className="sm:mr-2 animate-spin" /> : <Download size={18} className="sm:mr-2" />}
                    <span className="hidden sm:inline">Backup KML</span>
                  </Button>
                  <Button
                    variant={isEditingPath ? "secondary" : "outline"}
                    onClick={() => setIsEditingPath(!isEditingPath)}
                    className={isEditingPath ? "bg-primary text-primary-foreground hover:bg-primary/90" : ""}
                  >
                    <GitBranch size={18} className="sm:mr-2" />
                    <span className="hidden sm:inline">{isEditingPath ? "Keluar Edit Mode" : "Edit Mode"}</span>
                  </Button>
                  <Button variant="outline" onClick={() => setIsAddClientModalOpen(true)}>
                    <User size={18} className="sm:mr-2" /> <span className="hidden sm:inline">Tambah Client</span>
                  </Button>
                  <Button onClick={() => setIsAddModalOpen(true)}><Plus size={18} className="sm:mr-2" /> <span className="hidden sm:inline">Tambah Aset</span></Button>
                </>
              )}
            </div>
          </div>
          {isEditingPath && (
            <div className="mt-4 p-4 bg-primary/10 border border-primary/20 rounded-xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 shadow-lg animate-in fade-in slide-in-from-top-4 duration-300">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 bg-primary rounded-full animate-ping flex-shrink-0" />
                <div>
                  <p className="text-sm font-bold">EDIT MODE AKTIF</p>
                  <p className="text-xs text-muted-foreground">
                    {pathTarget
                      ? "Klik peta untuk menambah belokan, geser titik, atau klik ikon lain untuk pindah edit."
                      : "Geser Aset/Client untuk pindah lokasi. Klik garis atau ikon untuk edit jalur koneksi."}
                  </p>
                </div>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    // Batal: rollback semua pending marker moves
                    pendingMarkerMoves.forEach(move => {
                      if (move.type === 'asset') {
                        setAssets(prev => prev.map(a => a.id === move.id ? { ...a, latitude: move.origLat, longitude: move.origLng } : a));
                      } else {
                        setClients(prev => prev.map(c => c.id === move.id ? { ...c, latitude: move.origLat, longitude: move.origLng } : c));
                      }
                    });
                    setIsEditingPath(false);
                    setEditingPathPoints([]);
                    setPathTarget(null);
                    setPendingPathEdits(new Map());
                    setPathHistory([]);
                    setPendingMarkerMoves([]);
                  }}
                >
                  Batal
                </Button>
                {(pathTarget || pendingMarkerMoves.length > 0) && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        // Undo: untuk path edits gunakan handleUndo, untuk marker moves pop yang terakhir
                        if (pathHistory.length > 0) {
                          handleUndo();
                        } else if (pendingMarkerMoves.length > 0) {
                          const last = pendingMarkerMoves[pendingMarkerMoves.length - 1];
                          // Rollback optimistic update
                          if (last.type === 'asset') {
                            setAssets(prev => prev.map(a => a.id === last.id ? { ...a, latitude: last.origLat, longitude: last.origLng } : a));
                          } else {
                            setClients(prev => prev.map(c => c.id === last.id ? { ...c, latitude: last.origLat, longitude: last.origLng } : c));
                          }
                          setPendingMarkerMoves(prev => prev.slice(0, -1));
                        }
                      }}
                      disabled={pathHistory.length === 0 && pendingMarkerMoves.length === 0}
                    >
                      Undo
                    </Button>
                    <Button size="sm" onClick={handleSavePath}>Simpan</Button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex-grow grid grid-cols-1 lg:grid-cols-5 gap-4 lg:gap-6 min-h-0">
          <div className="lg:col-span-1 lg:h-[calc(100vh-200px)] flex flex-col gap-2 lg:gap-4 lg:min-h-0">
            <AssetList
              assets={filteredAssets}
              loading={loading}
              selectedAssetId={selectedAsset?.id}
              onAssetSelect={handleAssetSelect}
              onAssetView={handleAssetView}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              onBulkDelete={!isNocMode ? handleBulkDeleteAssets : undefined}
            />
            <ClientList
              clients={filteredClients}
              loading={clientsLoading}
              selectedClientId={selectedClient?.id}
              onClientSelect={handleClientSelect}
              onClientView={handleClientView}
              searchQuery={clientSearchQuery}
              onSearchChange={setClientSearchQuery}
              pppoeSecrets={pppoeSecrets}
              onBulkDelete={!isNocMode ? handleBulkDeleteClients : undefined}
            />
          </div>
          <div className="lg:col-span-4 min-h-[400px] lg:min-h-[calc(100vh-200px)] relative z-10">
            <MapDisplay
              assets={displayAssets}
              clients={showClients ? displayClients : []}
              onMarkerClick={isEditingPath ? (asset) => handleLineClick('asset', asset.id, undefined, true) : handleAssetView}
              onClientClick={isEditingPath ? (client) => handleLineClick('client', client.id, undefined, true) : handleClientView}
              showLines={showLines}
              visibleTypes={visibleTypes}
              showClients={showClients}
              selectedAssetId={selectedAsset?.id}
              selectedClientId={selectedClient?.id}
              isEditingPath={isEditingPath}
              editingPathPoints={editingPathPoints}
              activePathTarget={pathTarget}
              onMapClick={handleMapClick}
              onLineSelect={handleLineClick}
              onWaypointDrag={handleWaypointDrag}
              onWaypointDragStart={handleWaypointDragStart}
              isPullingNewPoint={isPullingNewPoint}
              activeDraggedIndex={activeDraggedIndex}
              onMouseUp={handleMouseUp}
              onMarkerDragEnd={handleMarkerDragEnd}
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
              showClients={showClients}
              onToggleClients={setShowClients}
              showUp={showUp}
              onToggleUp={setShowUp}
              showDown={showDown}
              onToggleDown={setShowDown}
            />
          </div>
        </div>
      </div>

      <AddAssetModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSuccess={handleSuccess}
        nocWorkspaceId={isNocMode ? (selectedWorkspaceForNocAdd || nocWorkspaceIds[0]) : undefined}
      />

      {selectedAsset && (
        <>
          <AssetDetailModal
            isOpen={isDetailModalOpen}
            onClose={() => setIsDetailModalOpen(false)}
            asset={selectedAsset}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onAddConnection={handleAddConnection}
            onEditPath={(asset: Asset) => handleStartEditPath('asset', asset)}
            nocWorkspaceId={isNocMode ? selectedAsset.workspace_id : undefined}
          />
          <EditAssetModal
            isOpen={isEditModalOpen}
            onClose={() => setIsEditModalOpen(false)}
            assetToEdit={selectedAsset}
            onSuccess={handleSuccess}
            nocWorkspaceId={isNocMode ? selectedAsset.workspace_id : undefined}
          />
          <AddConnectionModal
            isOpen={isAddConnectionModalOpen}
            onClose={() => setIsAddConnectionModalOpen(false)}
            asset={selectedAsset}
            onSuccess={handleSuccess}
            nocWorkspaceId={isNocMode ? selectedAsset.workspace_id : undefined}
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
        nocWorkspaceId={isNocMode ? (selectedWorkspaceForNocAdd || nocWorkspaceIds[0]) : undefined}
      />

      {selectedClient && (
        <>
          <ClientDetailModal
            isOpen={isClientDetailModalOpen}
            onClose={() => setIsClientDetailModalOpen(false)}
            client={selectedClient}
            onEdit={handleEditClient}
            onDelete={handleDeleteClient}
            onEditPath={(client: Client) => handleStartEditPath('client', client)}
            nocWorkspaceId={isNocMode ? selectedClient.workspace_id : undefined}
          />
          <EditClientModal
            isOpen={isEditClientModalOpen}
            onClose={() => setIsEditClientModalOpen(false)}
            onSuccess={handleSuccess}
            client={selectedClient}
            assets={assets}
            nocWorkspaceId={isNocMode ? selectedClient.workspace_id : undefined}
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

      {/* Bulk Delete Confirm Modal */}
      {pendingBulkDelete && (
        <ConfirmModal
          isOpen={!!pendingBulkDelete}
          onClose={() => setPendingBulkDelete(null)}
          onConfirm={executeBulkDelete}
          title={`Hapus ${pendingBulkDelete.ids.length} ${pendingBulkDelete.type === 'asset' ? 'Aset' : 'Client'}?`}
          description={`Tindakan ini tidak dapat diurungkan. ${pendingBulkDelete.ids.length} ${pendingBulkDelete.type === 'asset' ? 'aset' : 'client'} yang dipilih akan dihapus secara permanen.`}
        />
      )}

    </>
  );
};

export default LocationManager;