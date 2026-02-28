'use client';

import React, { useState, useEffect } from 'react';
import { Server, Box, GitBranch, Share2, Loader2, RadioTower, Search, ChevronDown, ChevronUp, Trash2, CheckSquare, Square, X } from 'lucide-react';
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
  const [showSearch, setShowSearch] = useState(false);
  const searchInputRef = React.useRef<HTMLInputElement>(null);

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
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity flex-1 min-w-0" title={isCollapsed ? "Buka daftar" : "Tutup daftar"} onClick={() => {
              if (!isSelectMode) {
                const willExpand = isCollapsed;
                setIsCollapsed(!willExpand);
                if (willExpand) {
                  window.dispatchEvent(new CustomEvent('collapse-client-list'));
                }
              }
            }}>
              <CardTitle className="text-base lg:text-lg truncate">Daftar Aset ({filteredAssets.length})</CardTitle>
              <button className="lg:hidden text-muted-foreground shrink-0" aria-label="Toggle">
                {isCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
              </button>
            </div>

            <div className="flex items-center gap-1 shrink-0 ml-2">
              {onBulkDelete && (
                <>
                  {isSelectMode ? (
                    <div className="flex items-center gap-1">
                      {selectedIds.size > 0 && (
                        <Button
                          size="icon"
                          variant="destructive"
                          className="h-8 w-8 relative shrink-0"
                          title={`Hapus ${selectedIds.size} item`}
                          onClick={handleDeleteSelected}
                        >
                          <Trash2 size={14} />
                          <span className="absolute -top-1.5 -right-1.5 bg-background text-destructive text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center border border-destructive">
                            {selectedIds.size}
                          </span>
                        </Button>
                      )}
                      <Button
                        size="icon"
                        variant="outline"
                        className="h-8 w-8 shrink-0"
                        title="Batal Mode Pilih"
                        onClick={() => setIsSelectMode(false)}
                      >
                        <span title="Batal Mode Pilih">✕</span>
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-destructive hover:bg-destructive/10 shrink-0"
                      title="Pilih & Hapus Aset Massal"
                      onClick={() => { setIsSelectMode(true); setIsCollapsed(false); }}
                    >
                      <Trash2 size={15} />
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between w-full">
            <div className="flex-1">
              {(!isSelectMode && onSearchChange) && (
                showSearch ? (
                  <div className="relative w-full">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      ref={searchInputRef}
                      type="text"
                      placeholder="Cari aset..."
                      value={searchQuery}
                      autoFocus
                      onClick={() => {
                        setIsCollapsed(false);
                        window.dispatchEvent(new CustomEvent('collapse-client-list'));
                      }}
                      onBlur={() => { if (!searchQuery) setShowSearch(false); }}
                      onChange={(e) => {
                        setIsCollapsed(false);
                        window.dispatchEvent(new CustomEvent('collapse-client-list'));
                        onSearchChange(e.target.value);
                      }}
                      className="pl-8 pr-7 bg-input text-sm h-8 w-full"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          if (onSearchChange) onSearchChange('');
                          setIsCollapsed(false);
                          window.dispatchEvent(new CustomEvent('collapse-client-list'));
                          searchInputRef.current?.focus();
                        }}
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                ) : (
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-8 text-muted-foreground hover:text-foreground w-full justify-start px-3 text-xs"
                    title="Cari Aset"
                    onClick={() => {
                      setShowSearch(true);
                      setIsCollapsed(false);
                      window.dispatchEvent(new CustomEvent('collapse-client-list'));
                    }}
                  >
                    <Search size={14} className="mr-2" /> Cari aset...
                  </Button>
                )
              )}
            </div>
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
        <CardContent className="flex-grow overflow-y-auto p-1.5 max-h-[240px] lg:max-h-none">
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