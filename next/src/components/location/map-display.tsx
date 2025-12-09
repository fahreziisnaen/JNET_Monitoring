'use client';

import React, { useMemo, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Tooltip, Polyline, useMap, ZoomControl } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { Asset } from './asset-list';
import { Client } from './client-list';

delete (L.Icon.Default.prototype as any)._getIconUrl;

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
    iconAnchor: [18, 36],
    popupAnchor: [0, -36],
  });
};

const getAssetIcon = (asset: Asset, isSelected: boolean = false) => {
  if (!asset || !asset.type) {
    // Fallback jika asset tidak valid
    return L.divIcon({
      html: '<div style="width: 36px; height: 36px; background: #6b7280; border-radius: 50%; border: 2px solid white;"></div>',
      className: 'leaflet-custom-icon',
      iconSize: [36, 36],
      iconAnchor: [18, 36],
      popupAnchor: [0, -36],
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
  const iconAnchor = hasBadge ? [22, 44] : [18, 36];
  const popupAnchor = hasBadge ? [0, -44] : [0, -36];

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
      iconAnchor: [18, 36],
      popupAnchor: [0, -36],
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
}

const MapDisplay = ({ assets, clients = [], onMarkerClick, onClientClick, showLines = true, visibleTypes, showClients = true, selectedAssetId, selectedClientId }: MapDisplayProps) => {
  // Debug: log assets untuk troubleshooting
  React.useEffect(() => {
    if (assets && assets.length > 0) {
      console.log('[MapDisplay] Assets received:', assets.length, assets.slice(0, 2));
    } else {
      console.warn('[MapDisplay] No assets received or empty array');
    }
  }, [assets]);

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
    <MapContainer 
      key={mapKey}
      center={mapCenter} 
      zoom={16} 
      minZoom={3}
      maxZoom={22}
      scrollWheelZoom={true} 
      style={{ height: '100%', width: '100%', borderRadius: '0.75rem' }}
    >
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={22} />
      <ZoomControl position="bottomright" />
      <MapZoomHandler 
        selectedAssetId={selectedAssetId} 
        selectedClientId={selectedClientId}
        assets={validAssets}
        clients={validClients}
      />
      
      {/* Render connection lines */}
      {connectionLines.map((line, index) => {
        // Generate unique key berdasarkan type dari dan ke
        // Gunakan prefix untuk membedakan Asset dan Client
        const fromId = 'type' in line.from ? `asset-${line.from.id}` : `client-${line.from.id}`;
        const toId = 'type' in line.to ? `asset-${line.to.id}` : `client-${line.to.id}`;
        const lineKey = `line-${fromId}-${toId}-${line.status}-${index}`;
        
        return (
        <Polyline
            key={lineKey}
          positions={[
            [line.from.latitude, line.from.longitude],
            [line.to.latitude, line.to.longitude]
          ]}
          pathOptions={{
            color: line.color,
            weight: 4,
            opacity: 0.8,
            dashArray: line.status === 'rencana' ? '10, 5' : line.status === 'maintenance' ? '5, 5' : undefined // Dashed untuk rencana dan maintenance
          }}
        />
        );
      })}
      
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
            eventHandlers={{ click: () => onMarkerClick(asset) }}
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
              eventHandlers={{ click: () => onClientClick?.(client) }}
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
  );
};
export default MapDisplay;