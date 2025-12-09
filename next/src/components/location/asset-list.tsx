'use client';

import React from 'react';
import { Server, Box, GitBranch, Share2, Loader2, RadioTower, Search } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export interface Asset {
  id: number;
  name: string;
  // Hierarki fisik: Mikrotik -> OLT -> ODC -> ODP
  type: 'Mikrotik' | 'OLT' | 'ODC' | 'ODP';
  latitude: number;
  longitude: number;
  description?: string;
  splitter_count?: number;
  parent_asset_id?: number | null;
  connection_status?: 'terpasang' | 'rencana' | 'maintenance' | 'putus';
  owner_name?: string | null;
  totalUsers?: number;
  activeUsers?: number;
}

const getAssetStyle = (type: Asset['type']) => {
  const styles: Record<Asset['type'], { icon: React.ReactElement; color: string }> = {
    Mikrotik: { icon: <RadioTower size={20} />, color: 'bg-cyan-500' },
    OLT: { icon: <Server size={20} />, color: 'bg-indigo-500' },
    ODC: { icon: <Box size={20} />, color: 'bg-amber-500' },
    ODP: { icon: <GitBranch size={20} />, color: 'bg-emerald-500' },
  };
  return styles[type];
};

interface AssetListProps {
  assets: Asset[];
  loading: boolean;
  selectedAssetId?: number | null;
  onAssetSelect: (asset: Asset) => void;
  onAssetView?: (asset: Asset) => void;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
}

const AssetList = ({ assets, loading, selectedAssetId, onAssetSelect, onAssetView, searchQuery = '', onSearchChange }: AssetListProps) => {
  // Filter assets berdasarkan search query
  const filteredAssets = React.useMemo(() => {
    if (!searchQuery.trim()) return assets;
    
    const query = searchQuery.toLowerCase().trim();
    return assets.filter(asset => {
      const nameMatch = asset.name.toLowerCase().includes(query);
      const typeMatch = asset.type.toLowerCase().includes(query);
      const ownerMatch = asset.owner_name?.toLowerCase().includes(query);
      const descriptionMatch = asset.description?.toLowerCase().includes(query);
      
      return nameMatch || typeMatch || ownerMatch || descriptionMatch;
    });
  }, [assets, searchQuery]);

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="mb-3">Daftar Aset ({filteredAssets.length})</CardTitle>
        {onSearchChange && (
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Cari aset (nama, tipe, owner)..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-9 bg-input"
            />
          </div>
        )}
      </CardHeader>
      <CardContent className="flex-grow overflow-y-auto p-2">
        {loading ? (
          <div className="flex justify-center items-center h-full"><Loader2 className="animate-spin h-8 w-8 text-muted-foreground"/></div>
        ) : filteredAssets.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-4">
            <p className="text-muted-foreground">
              {searchQuery ? 'Tidak ada aset yang sesuai dengan pencarian' : 'Tidak ada aset'}
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {filteredAssets.map(asset => {
              const style = getAssetStyle(asset.type);
              const isSelected = selectedAssetId === asset.id;
              return (
                <li key={asset.id}>
                  <button 
                    onClick={() => onAssetSelect(asset)}
                    onDoubleClick={() => onAssetView?.(asset)}
                    className={`w-full flex items-center gap-3 p-3 rounded-lg text-left transition-all duration-200 ${isSelected ? 'bg-primary/10 ring-2 ring-primary' : 'hover:bg-secondary'}`}
                  >
                    <div className={`flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-white ${style.color}`}>{style.icon}</div>
                    <div className="flex-grow overflow-hidden">
                      <p className="font-semibold truncate">{asset.name}</p>
                      <p className="text-xs text-muted-foreground">{asset.type}</p>
                      {asset.owner_name && (
                        <p className="text-xs text-muted-foreground/70 truncate">Owner: {asset.owner_name}</p>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
};
export default AssetList;