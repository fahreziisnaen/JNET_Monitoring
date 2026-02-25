'use client';

import React, { useState, useEffect } from 'react';
import { Server, Box, GitBranch, Share2, Loader2, RadioTower, Search, ChevronDown, ChevronUp, Trash2, CheckSquare, Square } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

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
  connection_path?: string | [number, number][];
  photo_url?: string | null;
  workspace_id?: number;
  workspace_name?: string;
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
  onBulkDelete?: (ids: number[]) => void;
  selectionMode?: boolean;
}

const AssetList = ({ assets, loading, selectedAssetId, onAssetSelect, onAssetView, searchQuery = '', onSearchChange, onBulkDelete, selectionMode = false }: AssetListProps) => {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isSelectMode, setIsSelectMode] = useState(false);

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

  // Collapsed by default on mobile, always expanded on lg+
  const [isCollapsed, setIsCollapsed] = useState(true);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const handler = (e: MediaQueryListEvent | MediaQueryList) => {
      if (e.matches) setIsCollapsed(false);
      else setIsCollapsed(true);
    };
    handler(mq);
    mq.addEventListener('change', handler);

    const handleForceCollapse = () => setIsCollapsed(true);
    window.addEventListener('collapse-asset-list', handleForceCollapse);

    return () => {
      mq.removeEventListener('change', handler);
      window.removeEventListener('collapse-asset-list', handleForceCollapse);
    };
  }, []);

  // Reset selection when leaving select mode
  useEffect(() => {
    if (!isSelectMode) setSelectedIds(new Set());
  }, [isSelectMode]);

  const allFilteredSelected = filteredAssets.length > 0 && filteredAssets.every(a => selectedIds.has(a.id));

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        filteredAssets.forEach(a => next.delete(a.id));
        return next;
      });
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev);
        filteredAssets.forEach(a => next.add(a.id));
        return next;
      });
    }
  };

  const toggleItem = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDeleteSelected = () => {
    if (selectedIds.size === 0) return;
    onBulkDelete?.(Array.from(selectedIds));
    setSelectedIds(new Set());
    setIsSelectMode(false);
  };

  return (
    <Card className={`flex flex-col transition-all duration-300 ${isCollapsed ? 'flex-shrink-0' : 'flex-1 min-h-0'}`}>
      <CardHeader className="pb-2 px-3 py-2 lg:px-6 lg:py-3 lg:cursor-default">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => !isSelectMode && setIsCollapsed(prev => !prev)}>
            <CardTitle className="text-base lg:text-lg whitespace-nowrap">Daftar Aset ({filteredAssets.length})</CardTitle>
            <button className="lg:hidden text-muted-foreground" aria-label="Toggle">
              {isCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
            </button>
          </div>

          <div className="flex items-center gap-1.5 flex-1 justify-end">
            {!isSelectMode && onSearchChange && (
              <div className="relative flex-1 max-w-[160px]">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Cari aset..."
                  value={searchQuery}
                  onClick={() => setIsCollapsed(false)}
                  onFocus={() => {
                    setIsCollapsed(false);
                    window.dispatchEvent(new CustomEvent('collapse-client-list'));
                  }}
                  onChange={(e) => {
                    setIsCollapsed(false);
                    window.dispatchEvent(new CustomEvent('collapse-client-list'));
                    onSearchChange(e.target.value);
                  }}
                  className="pl-8 bg-input text-sm h-8"
                />
              </div>
            )}

            {onBulkDelete && (
              <>
                {isSelectMode ? (
                  <div className="flex items-center gap-1.5">
                    {selectedIds.size > 0 && (
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-8 px-2 text-xs gap-1"
                        onClick={handleDeleteSelected}
                      >
                        <Trash2 size={13} />
                        Hapus ({selectedIds.size})
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 px-2 text-xs"
                      onClick={() => setIsSelectMode(false)}
                    >
                      Batal
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 px-2 text-xs gap-1 text-destructive border-destructive/40 hover:bg-destructive/10"
                    onClick={() => { setIsSelectMode(true); setIsCollapsed(false); }}
                  >
                    <Trash2 size={13} />
                    <span className="hidden sm:inline">Pilih & Hapus</span>
                  </Button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Select All bar */}
        {isSelectMode && !isCollapsed && filteredAssets.length > 0 && (
          <button
            onClick={toggleSelectAll}
            className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full px-1"
          >
            {allFilteredSelected
              ? <CheckSquare size={15} className="text-primary" />
              : <Square size={15} />
            }
            {allFilteredSelected ? 'Batal Pilih Semua' : `Pilih Semua (${filteredAssets.length})`}
          </button>
        )}
      </CardHeader>

      {!isCollapsed && (
        <CardContent className="flex-grow overflow-y-auto p-1.5 max-h-[120px] lg:max-h-none">
          {loading ? (
            <div className="flex justify-center items-center h-full"><Loader2 className="animate-spin h-6 w-6 text-muted-foreground" /></div>
          ) : filteredAssets.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-4">
              <p className="text-muted-foreground text-sm">
                {searchQuery ? 'Tidak ada aset yang sesuai dengan pencarian' : 'Tidak ada aset'}
              </p>
            </div>
          ) : (
            <ul className="space-y-1.5">
              {filteredAssets.map(asset => {
                const style = getAssetStyle(asset.type);
                const isSelected = selectedAssetId === asset.id;
                const isChecked = selectedIds.has(asset.id);
                return (
                  <li key={asset.id}>
                    <div
                      className={`w-full flex items-center gap-2 lg:gap-3 p-2 lg:p-3 rounded-lg text-left transition-all duration-200 ${isSelectMode
                          ? isChecked
                            ? 'bg-destructive/10 ring-2 ring-destructive/50'
                            : 'hover:bg-secondary cursor-pointer'
                          : isSelected
                            ? 'bg-primary/10 ring-2 ring-primary'
                            : 'hover:bg-secondary cursor-pointer'
                        }`}
                      onClick={() => {
                        if (isSelectMode) {
                          toggleItem(asset.id);
                        } else {
                          onAssetSelect(asset);
                        }
                      }}
                      onDoubleClick={() => !isSelectMode && onAssetView?.(asset)}
                    >
                      {isSelectMode && (
                        <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
                          {isChecked
                            ? <CheckSquare size={18} className="text-destructive" />
                            : <Square size={18} className="text-muted-foreground" />
                          }
                        </div>
                      )}
                      <div className={`flex-shrink-0 w-8 h-8 lg:w-10 lg:h-10 rounded-lg flex items-center justify-center text-white ${style.color} ${isSelectMode ? 'opacity-70' : ''}`}>
                        {style.icon}
                      </div>
                      <div className="flex-grow overflow-hidden">
                        <p className="font-semibold truncate text-sm lg:text-base">{asset.name}</p>
                        <p className="text-xs lg:text-sm text-muted-foreground">{asset.type}</p>
                        {asset.owner_name && (
                          <p className="text-sm text-muted-foreground/70 truncate">Owner: {asset.owner_name}</p>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      )}
    </Card>
  );
};
export default AssetList;