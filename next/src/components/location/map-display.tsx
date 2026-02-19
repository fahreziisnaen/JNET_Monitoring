'use client';

import React, { useMemo, useEffect, useRef } from 'react';
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Tooltip,
  Polyline,
  useMap,
  useMapEvents,
  ZoomControl,
  ScaleControl,
} from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { Asset } from './asset-list';
import { Client } from './client-list';

delete (L.Icon.Default.prototype as any)._getIconUrl;

// Component untuk auto-fit bounds menampilkan semua marker
const FitBoundsHandler = ({
  assets,
  clients
}: {
  assets: Asset[];
  clients: Client[];
}) => {
  const map = useMap();
  const hasFitted = React.useRef(false);

  useEffect(() => {
    // Only fit bounds once when map first loads
    if (!hasFitted.current && (assets.length > 0 || clients.length > 0)) {
      const bounds = L.latLngBounds([]);

      // Add all assets to bounds
      assets.forEach(asset => {
        if (asset.latitude && asset.longitude) {
          bounds.extend([asset.latitude, asset.longitude]);
        }
      });

      // Add all clients to bounds
      clients.forEach(client => {
        if (client.latitude && client.longitude) {
          bounds.extend([client.latitude, client.longitude]);
        }
      });

      // Fit map to bounds if we have any markers
      if (bounds.isValid()) {
        map.fitBounds(bounds, {
          padding: [50, 50],
          maxZoom: 17,
          animate: false
        });
        hasFitted.current = true;
      }
    }
  }, [assets, clients, map]);

  return null;
};

// Component untuk zoom ke selected asset atau client
const MapZoomHandler = ({
  selectedAssetId,
  selectedClientId,
  assets,
  clients
}: {
  selectedAssetId?: number | null;
  selectedClientId?: number | null;
  assets: Asset[];
  clients: Client[];
}) => {
  const map = useMap();
  const prevSelectedAssetId = React.useRef<number | null | undefined>(null);
  const prevSelectedClientId = React.useRef<number | null | undefined>(null);

  useEffect(() => {
    if (selectedAssetId && selectedAssetId !== prevSelectedAssetId.current) {
      const selectedAsset = assets.find(a => a.id === selectedAssetId);
      if (selectedAsset) {
        const currentZoom = map.getZoom();
        const targetZoom = currentZoom < 16 ? 16 : currentZoom;
        map.setView([selectedAsset.latitude, selectedAsset.longitude], targetZoom, {
          animate: true,
          duration: 0.5
        });
        prevSelectedAssetId.current = selectedAssetId;
      }
    } else if (!selectedAssetId) {
      prevSelectedAssetId.current = null;
    }
  }, [selectedAssetId, assets, map]);

  useEffect(() => {
    if (selectedClientId && selectedClientId !== prevSelectedClientId.current) {
      const selectedClient = clients.find(c => c.id === selectedClientId);
      if (selectedClient) {
        const currentZoom = map.getZoom();
        const targetZoom = currentZoom < 16 ? 16 : currentZoom;
        map.setView([selectedClient.latitude, selectedClient.longitude], targetZoom, {
          animate: true,
          duration: 0.5
        });
        prevSelectedClientId.current = selectedClientId;
      }
    } else if (!selectedClientId) {
      prevSelectedClientId.current = null;
    }
  }, [selectedClientId, clients, map]);

  return null;
};

const MapClickHandler = ({ isEditingPath, onMapClick }: { isEditingPath: boolean, onMapClick?: (latlng: [number, number]) => void }) => {
  useMapEvents({
    click: (e: L.LeafletMouseEvent) => {
      if (isEditingPath && onMapClick) {
        onMapClick([e.latlng.lat, e.latlng.lng]);
      }
    },
  });
  return null;
};

// Component untuk mengontrol interaksi map saat mode edit
const MapInteractionHandler = ({ isPullingNewPoint, activeDraggedIndex, onWaypointDrag, onMouseUp }: {
  isPullingNewPoint: boolean,
  activeDraggedIndex: number | null,
  onWaypointDrag?: (index: number, latlng: [number, number]) => void,
  onMouseUp?: () => void
}) => {
  const map = useMap();

  useMapEvents({
    mousemove: (e) => {
      if (isPullingNewPoint && activeDraggedIndex !== null && onWaypointDrag) {
        onWaypointDrag(activeDraggedIndex, [e.latlng.lat, e.latlng.lng]);
      }
    },
    mouseup: () => {
      // Selalu coba hidupkan kembali dragging saat mouse dilepas
      map.dragging.enable();
      if (map.doubleClickZoom) map.doubleClickZoom.enable();

      if (isPullingNewPoint && onMouseUp) {
        onMouseUp();
      }
    }
  });

  // Pastikan dragging menyala sesuai state
  useEffect(() => {
    if (isPullingNewPoint) {
      map.dragging.disable();
      if (map.doubleClickZoom) map.doubleClickZoom.disable();
    } else {
      map.dragging.enable();
      if (map.doubleClickZoom) map.doubleClickZoom.enable();
    }
  }, [map, isPullingNewPoint]);

  return null;
};

const getClientIcon = (isSelected: boolean = false, isActive: boolean = true) => {
  // Warna berdasarkan status aktif: hijau jika aktif, merah jika tidak aktif
  const color = isActive ? '#10b981' : '#ef4444'; // hijau untuk active, merah untuk inactive

  // Warna untuk selected style (ring highlight)
  const selectedColor = isActive ? '#10b981' : '#ef4444';
  const selectedStyle = isSelected ? `
    <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 52px; height: 52px; border: 3px solid ${selectedColor}; border-radius: 50%; opacity: 0.8; box-shadow: 0 0 0 3px rgba(${isActive ? '16, 185, 129' : '239, 68, 68'}, 0.4), 0 0 0 6px rgba(${isActive ? '16, 185, 129' : '239, 68, 68'}, 0.2), 0 0 20px rgba(${isActive ? '16, 185, 129' : '239, 68, 68'}, 0.5); z-index: 1000;"></div>
  ` : '';

  const svgIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32">
      <circle cx="12" cy="12" r="10" fill="${color}" stroke="#fff" stroke-width="2"/>
      <path fill="white" d="M12 12c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2v2h4v-2c0-1.1-.9-2-2-2z"/>
    </svg>`;

  const iconHtml = `<div style="position: relative; width: 36px; height: 36px; display: block; z-index: ${isSelected ? 1000 : 1};">${selectedStyle}${svgIcon}</div>`;

  return L.divIcon({
    html: iconHtml,
    className: 'leaflet-custom-icon',
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -18],
  });
};

const getAssetIcon = (asset: Asset, isSelected: boolean = false) => {
  if (!asset || !asset.type) {
    // Fallback jika asset tidak valid
    return L.divIcon({
      html: '<div style="width: 36px; height: 36px; background: #6b7280; border-radius: 50%; border: 2px solid white;"></div>',
      className: 'leaflet-custom-icon',
      iconSize: [36, 36],
      iconAnchor: [18, 18],
      popupAnchor: [0, -18],
    });
  }

  // Tentukan warna berdasarkan tipe asset
  let color: string;

  if (asset.type === 'ODP') {
    // ODP: biru normal, merah jika semua client mati
    const activeUsers = asset.activeUsers || 0;
    const totalUsers = asset.totalUsers || 0;
    // Jika ada client (totalUsers > 0) tapi semua mati (activeUsers === 0), maka merah
    if (totalUsers > 0 && activeUsers === 0) {
      color = '#ef4444'; // merah
    } else {
      color = '#3b82f6'; // biru
    }
  } else if (asset.type === 'ODC') {
    color = '#a855f7'; // ungu
  } else if (asset.type === 'Mikrotik') {
    color = '#06b6d4'; // cyan
  } else if (asset.type === 'OLT') {
    color = '#f59e0b'; // oranye
  } else {
    color = '#6b7280'; // default gray
  }

  // Jika selected, tambahkan ring highlight dengan shadow yang lebih jelas
  const selectedStyle = isSelected ? `
    <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 52px; height: 52px; border: 3px solid ${color}; border-radius: 50%; opacity: 0.8; box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.4), 0 0 0 6px rgba(59, 130, 246, 0.2), 0 0 20px rgba(59, 130, 246, 0.5); z-index: 1000;"></div>
  ` : '';

  // Badge untuk ODP dengan jumlah user aktif
  const hasBadge = asset.type === 'ODP' && asset.totalUsers !== undefined && asset.totalUsers !== null && asset.totalUsers > 0;
  let badgeHtml = '';

  if (hasBadge) {
    const activeUsers = asset.activeUsers || 0;
    const totalUsers = asset.totalUsers;
    const badgeColor = activeUsers === 0 ? '#ef4444' : activeUsers === totalUsers ? '#10b981' : '#f59e0b';
    const badgeText = `${activeUsers}/${totalUsers}`;

    badgeHtml = `<div style="position: absolute; top: -6px; right: -6px; background: ${badgeColor}; color: white; border-radius: 8px; padding: 1px 5px; font-size: 9px; font-weight: bold; border: 2px solid white; box-shadow: 0 1px 3px rgba(0,0,0,0.3); min-width: 24px; text-align: center; white-space: nowrap; line-height: 1.2;">${badgeText}</div>`;
  }

  // Gunakan iconSize yang lebih besar jika ada badge
  const iconSize = hasBadge ? [44, 44] : [36, 36];
  const iconAnchor = hasBadge ? [22, 22] : [18, 18];
  const popupAnchor = hasBadge ? [0, -22] : [0, -18];

  // Buat icon HTML - pastikan struktur sederhana dan valid
  const svgIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="36" height="36">
      <path fill="${color}" stroke="#fff" stroke-width="1" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
      <circle cx="12" cy="9.5" r="2.5" fill="white" />
    </svg>`;

  const iconHtml = hasBadge
    ? `<div style="position: relative; width: ${iconSize[0]}px; height: ${iconSize[1]}px; display: block; z-index: ${isSelected ? 1000 : 1};">${selectedStyle}${svgIcon}${badgeHtml}</div>`
    : `<div style="position: relative; width: ${iconSize[0]}px; height: ${iconSize[1]}px; display: block; z-index: ${isSelected ? 1000 : 1};">${selectedStyle}${svgIcon}</div>`;

  try {
    return L.divIcon({
      html: iconHtml,
      className: 'leaflet-custom-icon',
      iconSize: iconSize as [number, number],
      iconAnchor: iconAnchor as [number, number],
      popupAnchor: popupAnchor as [number, number],
    });
  } catch (error) {
    console.error('[getAssetIcon] Error creating icon:', error);
    // Fallback ke icon sederhana
    return L.divIcon({
      html: `<div style="width: 36px; height: 36px; background: ${color}; border-radius: 50%; border: 2px solid white;"></div>`,
      className: 'leaflet-custom-icon',
      iconSize: [36, 36],
      iconAnchor: [18, 18],
      popupAnchor: [0, -18],
    });
  }
};


interface MapDisplayProps {
  assets: Asset[];
  clients?: Client[];
  onMarkerClick: (asset: Asset) => void;
  onClientClick?: (client: Client) => void;
  showLines?: boolean;
  visibleTypes?: Set<string>;
  showClients?: boolean;
  selectedAssetId?: number | null;
  selectedClientId?: number | null;
  isEditingPath?: boolean;
  editingPathPoints?: [number, number][];
  activePathTarget?: { type: 'asset' | 'client', id: number } | null;
  onMapClick?: (latlng: [number, number]) => void;
  onLineSelect?: (type: 'asset' | 'client', id: number, latlng?: [number, number]) => void;
  onWaypointDrag?: (index: number, latlng: [number, number]) => void;
  onWaypointDragStart?: (points: [number, number][], dragIdx?: number) => void;
  isPullingNewPoint?: boolean;
  activeDraggedIndex?: number | null;
  onMouseUp?: () => void;
}

const MapDisplay = ({
  assets,
  clients = [],
  onMarkerClick,
  onClientClick,
  showLines = true,
  visibleTypes,
  showClients = true,
  selectedAssetId,
  selectedClientId,
  isEditingPath = false,
  editingPathPoints = [],
  activePathTarget = null,
  onMapClick,
  onLineSelect,
  onWaypointDrag,
  onWaypointDragStart,
  isPullingNewPoint = false,
  activeDraggedIndex = null,
  onMouseUp
}: MapDisplayProps) => {
  // Debug: log assets untuk troubleshooting
  React.useEffect(() => {
    if (assets && assets.length > 0) {
      console.log('[MapDisplay] Assets received:', assets.length, assets.slice(0, 2));
    } else {
      console.warn('[MapDisplay] No assets received or empty array');
    }
  }, [assets]);

  // Hilangkan border/grid pada tile map
  React.useEffect(() => {
    const styleId = 'leaflet-remove-grid';
    // Hapus style lama jika ada
    const existingStyle = document.getElementById(styleId);
    if (existingStyle) {
      existingStyle.remove();
    }

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .leaflet-tile {
        border: none !important;
        outline: none !important;
        margin: 0 !important;
        padding: 0 !important;
        border-width: 0 !important;
        box-shadow: none !important;
      }
      .leaflet-tile-container img {
        border: none !important;
        outline: none !important;
        margin: 0 !important;
        padding: 0 !important;
        display: block !important;
      }
      .leaflet-tile-container {
        overflow: visible !important;
      }
      .leaflet-zoom-animated img {
        border: none !important;
        outline: none !important;
        margin: 0 !important;
        padding: 0 !important;
      }
      @keyframes flow {
        from {
          stroke-dashoffset: 20;
        }
        to {
          stroke-dashoffset: 0;
        }
      }
      .flow-active {
        stroke-dasharray: 10, 10;
        animation: flow 1s linear infinite;
      }
    `;
    document.head.appendChild(style);
    return () => {
      const styleToRemove = document.getElementById(styleId);
      if (styleToRemove) {
        styleToRemove.remove();
      }
    };
  }, []);

  // Pastikan assets adalah array valid
  const validAssets = Array.isArray(assets) ? assets : [];

  // Valid clients
  const validClients = Array.isArray(clients) ? clients : [];

  // Hitung center dari valid assets atau clients
  const mapCenter: [number, number] = validAssets.length > 0
    ? [validAssets[0].latitude, validAssets[0].longitude]
    : validClients.length > 0
      ? [validClients[0].latitude, validClients[0].longitude]
      : [-7.821, 112.016];

  // Filter assets berdasarkan visibleTypes
  const filteredAssets = useMemo(() => {
    if (!validAssets || validAssets.length === 0) return [];
    if (!visibleTypes) return validAssets;
    return validAssets.filter(asset => asset && asset.type && visibleTypes.has(asset.type));
  }, [validAssets, visibleTypes]);

  // Buat map untuk lookup asset by id
  const assetMap = useMemo(() => {
    const map = new Map<number, Asset>();
    validAssets.forEach(asset => {
      if (asset && asset.id) {
        map.set(asset.id, asset);
      }
    });
    return map;
  }, [validAssets]);

  // Generate connection lines berdasarkan parent_asset_id dan client-to-ODP
  const connectionLines = useMemo(() => {
    if (!showLines) return [];

    const lines: Array<{ from: Asset | Client; to: Asset | Client; color: string; status: string }> = [];

    // Lines untuk asset-to-asset connections
    filteredAssets.forEach(asset => {
      if (asset.parent_asset_id) {
        const parent = assetMap.get(asset.parent_asset_id);
        if (parent && (!visibleTypes || visibleTypes.has(parent.type))) {
          // Ambil status dari asset.connection_status, default 'terpasang'
          const status = asset.connection_status || 'terpasang';

          // Tentukan warna berdasarkan status
          let color = '#10b981'; // green untuk Terpasang
          if (status === 'rencana') {
            color = '#3b82f6'; // blue untuk Rencana
          } else if (status === 'maintenance') {
            color = '#eab308'; // yellow untuk Maintenance
          } else if (status === 'putus') {
            color = '#ef4444'; // red untuk Putus
          }

          lines.push({ from: parent, to: asset, color, status });
        }
      }
    });

    // Lines untuk client-to-ODP connections
    // Tampilkan line jika showClients true dan ODP terlihat di map
    if (showClients && validClients) {
      validClients.forEach(client => {
        if (client.odp_asset_id) {
          const odp = assetMap.get(client.odp_asset_id);
          // Tampilkan line jika ODP ada, type ODP, dan ODP terlihat di map (visibleTypes)
          if (odp && odp.type === 'ODP' && (!visibleTypes || visibleTypes.has('ODP'))) {
            // Tentukan warna berdasarkan status client (active/inactive)
            const isActive = client.isActive === true;
            const color = isActive ? '#10b981' : '#ef4444'; // hijau untuk active, merah untuk inactive
            const status = isActive ? 'active' : 'inactive';

            lines.push({ from: odp, to: client, color, status });
          }
        }
      });
    }

    return lines;
  }, [filteredAssets, assetMap, showLines, visibleTypes, showClients, validClients]);


  // Generate key untuk memaksa re-render ketika assets berubah
  const mapKey = useMemo(() => {
    return `map-${validAssets.length}-${validAssets.map(a => a.id).join('-')}`;
  }, [validAssets]);

  return (
    <div id="map" style={{ height: '100%', width: '100%' }}>
      <MapContainer
        key={mapKey}
        center={mapCenter}
        zoom={19}
        minZoom={3}
        maxZoom={21}
        scrollWheelZoom={true}
        style={{ height: '100%', width: '100%', borderRadius: '0.75rem' }}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={21}
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          noWrap={false}
          tileSize={256}
          zoomOffset={0}
          className="leaflet-tile-no-border"
          crossOrigin="anonymous"
        />
        <ZoomControl position="bottomright" />
        <MapClickHandler isEditingPath={isEditingPath} onMapClick={onMapClick} />
        <FitBoundsHandler
          assets={validAssets}
          clients={validClients}
        />
        <MapZoomHandler
          selectedAssetId={selectedAssetId}
          selectedClientId={selectedClientId}
          assets={validAssets}
          clients={validClients}
        />
        <MapInteractionHandler
          isPullingNewPoint={isPullingNewPoint}
          activeDraggedIndex={activeDraggedIndex}
          onWaypointDrag={onWaypointDrag}
          onMouseUp={onMouseUp}
        />

        {/* Render connection lines */}
        {connectionLines.map((line, index) => {
          // Generate unique key berdasarkan type dari dan ke
          // Gunakan prefix untuk membedakan Asset dan Client
          const fromId = 'type' in line.from ? `asset-${line.from.id}` : `client-${line.from.id}`;
          const toId = 'type' in line.to ? `asset-${line.to.id}` : `client-${line.to.id}`;
          const lineKey = `line-${fromId}-${toId}-${line.status}-${index}`;

          // Parse connection_path jika ada
          let positions: [number, number][] = [
            [line.from.latitude, line.from.longitude],
            [line.to.latitude, line.to.longitude]
          ];

          if (line.to.connection_path) {
            try {
              const path = typeof line.to.connection_path === 'string'
                ? JSON.parse(line.to.connection_path)
                : line.to.connection_path;

              if (Array.isArray(path) && path.length >= 2) {
                // Filter out any invalid points
                const validPath = path.filter(p => Array.isArray(p) && !isNaN(Number(p[0])) && !isNaN(Number(p[1])));
                if (validPath.length >= 2) {
                  positions = validPath as [number, number][];
                }
              }
            } catch (e) {
              console.warn('Error parsing connection_path:', e);
            }
          }

          const isLineActive = activePathTarget &&
            activePathTarget.id === line.to.id &&
            activePathTarget.type === ('type' in line.to ? 'asset' : 'client');

          if (isLineActive) return null;

          return (
            <Polyline
              key={lineKey}
              positions={positions}
              bubblingMouseEvents={false}
              eventHandlers={{
                mousedown: (e) => {
                  if (isEditingPath) {
                    const map = (e.target as any)._map;
                    if (map) {
                      map.dragging.disable();
                      if (map.doubleClickZoom) map.doubleClickZoom.disable();
                    }
                  }
                  if (onLineSelect) {
                    L.DomEvent.stopPropagation(e.originalEvent || e);
                    const latlng: [number, number] = [e.latlng.lat, e.latlng.lng];
                    onLineSelect('type' in line.to ? 'asset' : 'client', line.to.id, latlng);
                  } else if (isEditingPath) {
                    L.DomEvent.stopPropagation(e.originalEvent || e);
                  }
                },
                click: (e) => {
                  if (isEditingPath) {
                    L.DomEvent.stopPropagation(e.originalEvent || e);
                  }
                }
              }}
              pathOptions={{
                color: isLineActive ? '#f59e0b' : line.color,
                weight: isLineActive ? 8 : 4,
                opacity: isLineActive ? 1 : 0.8,
                dashArray: line.status === 'rencana' ? '10, 5' : line.status === 'maintenance' ? '5, 5' : (line.status === 'terpasang' || line.status === 'active' ? '10, 10' : undefined),
                className: `${isEditingPath ? 'cursor-pointer transition-all' : ''} ${!isEditingPath && (line.status === 'terpasang' || line.status === 'active') ? 'flow-active' : ''}`.trim()
              }}
            />
          );
        })}

        {/* Render editing path points in real-time */}
        {isEditingPath && editingPathPoints.length > 0 && (
          <>
            <Polyline
              positions={editingPathPoints.filter(p => !isNaN(p[0]) && !isNaN(p[1]))}
              bubblingMouseEvents={false}
              pathOptions={{
                color: '#f59e0b',
                weight: 8,
                opacity: 1,
              }}
              eventHandlers={{
                mousedown: (e) => {
                  if (!isEditingPath || !activePathTarget || !onLineSelect) return;

                  // Immediately prevent map pan
                  const map = (e.target as any)._map;
                  if (map) {
                    map.dragging.disable();
                    if (map.doubleClickZoom) map.doubleClickZoom.disable();
                  }

                  L.DomEvent.stopPropagation(e.originalEvent || e);
                  const latlng: [number, number] = [e.latlng.lat, e.latlng.lng];
                  onLineSelect(activePathTarget.type, activePathTarget.id, latlng);
                },
                click: (e) => {
                  if (isEditingPath) {
                    L.DomEvent.stopPropagation(e.originalEvent || e);
                  }
                }
              }}
            />
            {editingPathPoints.map((point, idx) => {
              // Point pertama dan terakhir tidak bisa di-drag (koneksi utama)
              const isEndpoint = idx === 0 || idx === editingPathPoints.length - 1;
              if (isNaN(point[0]) || isNaN(point[1])) return null;

              return (
                <Marker
                  key={`edit-point-${idx}`}
                  position={point}
                  draggable={false}
                  eventHandlers={{
                    mousedown: (e) => {
                      if (isEndpoint || !isEditingPath) return;
                      if (e.originalEvent) L.DomEvent.stopPropagation(e.originalEvent);
                      else L.DomEvent.stopPropagation(e as any);

                      // Immediately disable map pan
                      const marker = e.target as any;
                      const map = marker._map;
                      if (map) {
                        map.dragging.disable();
                        if (map.doubleClickZoom) map.doubleClickZoom.disable();
                      }

                      // Push undo history and start pull mechanism for this waypoint
                      if (onWaypointDragStart) onWaypointDragStart(editingPathPoints, idx);
                    }
                  }}
                  icon={L.divIcon({
                    html: `<div style="
                    width: ${isEndpoint ? '10px' : '18px'}; 
                    height: ${isEndpoint ? '10px' : '18px'}; 
                    background: ${isEndpoint ? '#f59e0b' : '#fbbf24'}; 
                    border: 2px solid white; 
                    border-radius: 50%; 
                    box-shadow: 0 0 10px rgba(0,0,0,0.5);
                    cursor: ${isEndpoint ? 'default' : 'grab'};
                    pointer-events: ${isEndpoint ? 'none' : 'auto'};
                  "></div>`,
                    className: '',
                    iconSize: [18, 18],
                    iconAnchor: [9, 9]
                  })}
                  zIndexOffset={3000}
                />
              );
            })}
          </>
        )}

        {/* Render markers */}
        {filteredAssets.map(asset => {
          // Validasi asset sebelum render
          if (!asset) {
            console.warn('[MapDisplay] Asset is null/undefined');
            return null;
          }

          const lat = parseFloat(asset.latitude as any);
          const lon = parseFloat(asset.longitude as any);

          if (isNaN(lat) || isNaN(lon)) {
            console.warn('[MapDisplay] Invalid coordinates for asset:', asset.id, asset.name, 'lat:', asset.latitude, 'lon:', asset.longitude);
            return null;
          }

          const isSelected = selectedAssetId === asset.id;

          try {
            const icon = getAssetIcon(asset, isSelected);
            console.log('[MapDisplay] Rendering marker for:', asset.name, asset.type, 'at', lat, lon, 'selected:', isSelected);

            return (
              <Marker
                key={asset.id}
                position={[lat, lon]}
                eventHandlers={{
                  click: (e) => {
                    if (isEditingPath) {
                      L.DomEvent.stopPropagation(e.originalEvent || e);
                    }
                    onMarkerClick(asset);
                  }
                }}
                icon={icon}
                zIndexOffset={isSelected ? 1000 : 0}
              >
                <Tooltip permanent={false} direction="top" offset={[0, -10]} opacity={0.95}>
                  <div className="font-sans">
                    <p className="font-bold">{asset.name}</p>
                    <p>{asset.type}</p>
                    {asset.type === 'ODP' && asset.totalUsers !== undefined && asset.totalUsers > 0 && (
                      <p className="text-xs mt-1">
                        User: <span className={asset.activeUsers === 0 ? 'text-red-500 font-semibold' : asset.activeUsers === asset.totalUsers ? 'text-green-500' : 'text-amber-500'}>
                          {asset.activeUsers || 0}/{asset.totalUsers}
                        </span>
                      </p>
                    )}
                  </div>
                </Tooltip>
              </Marker>
            );
          } catch (error) {
            console.error('[MapDisplay] Error rendering marker for asset:', asset.id, asset.name, error);
            return null;
          }
        })}

        {/* Render client markers */}
        {showClients && validClients.map(client => {
          if (!client) return null;

          const lat = parseFloat(client.latitude as any);
          const lon = parseFloat(client.longitude as any);

          if (isNaN(lat) || isNaN(lon)) {
            console.warn('[MapDisplay] Invalid coordinates for client:', client.id, client.pppoe_secret_name);
            return null;
          }

          const isSelected = selectedClientId === client.id;
          const isActive = client.isActive === true;

          try {
            const icon = getClientIcon(isSelected, isActive);

            return (
              <Marker
                key={`client-${client.id}`}
                position={[lat, lon]}
                eventHandlers={{
                  click: (e) => {
                    if (isEditingPath) {
                      L.DomEvent.stopPropagation(e.originalEvent || e);
                    }
                    onClientClick?.(client);
                  }
                }}
                icon={icon}
                zIndexOffset={isSelected ? 1000 : 100}
              >
                <Tooltip permanent={false} direction="top" offset={[0, -10]} opacity={0.95}>
                  <div className="font-sans">
                    <p className="font-bold">{client.pppoe_secret_name}</p>
                    <p className="text-xs text-muted-foreground">Client</p>
                    {client.odp_name && (
                      <p className="text-xs mt-1">
                        ODP: <span className="text-primary">{client.odp_name}</span>
                      </p>
                    )}
                  </div>
                </Tooltip>
              </Marker>
            );
          } catch (error) {
            console.error('[MapDisplay] Error rendering marker for client:', client.id, client.pppoe_secret_name, error);
            return null;
          }
        })}
      </MapContainer>
    </div>
  );
};
export default MapDisplay;