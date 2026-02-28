'use client';

import React, { useState, useEffect } from 'react';
import { User, Loader2, Search, ChevronDown, ChevronUp, Trash2, CheckSquare, Square, X } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export interface Client {
  id: number;
  pppoe_secret_name: string;
  latitude: number;
  longitude: number;
  client_name?: string | null;
  whatsapp_number?: string | null;
  odp_asset_id: number | null;
  odp_name?: string | null;
  odp_owner_name?: string | null;
  isActive?: boolean;
  isOffline?: boolean;
  created_at?: string;
  updated_at?: string;
  connection_path?: string | [number, number][];
  photo_url?: string | null;
  workspace_id?: number;
  workspace_name?: string;
}

interface ClientListProps {
  clients: Client[];
  loading: boolean;
  selectedClientId?: number | null;
  onClientSelect: (client: Client) => void;
  onClientView?: (client: Client) => void;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  pppoeSecrets?: any[];
  onBulkDelete?: (ids: number[]) => void;
}

const ClientList = ({ clients, loading, selectedClientId, onClientSelect, onClientView, searchQuery = '', onSearchChange, pppoeSecrets, onBulkDelete }: ClientListProps) => {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  // Delay orphan detection until pppoeSecrets has been stable for a while
  // This prevents valid clients from briefly appearing as orphan during WS loading
  const [secretsReady, setSecretsReady] = useState(false);
  React.useEffect(() => {
    if (!pppoeSecrets || pppoeSecrets.length === 0) {
      setSecretsReady(false);
      return;
    }
    const timer = setTimeout(() => setSecretsReady(true), 4000);
    return () => clearTimeout(timer);
  }, [pppoeSecrets?.length]);

  const existingSecretsSet = React.useMemo(() => {
    return new Set(pppoeSecrets?.map((s: any) => s.name) || []);
  }, [pppoeSecrets]);

  const filteredClients = React.useMemo(() => {
    let result = [...clients];

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      result = result.filter(client => {
        const nameMatch = client.pppoe_secret_name.toLowerCase().includes(query);
        const odpMatch = client.odp_name?.toLowerCase().includes(query);
        const clientNameMatch = client.client_name?.toLowerCase().includes(query);
        return nameMatch || odpMatch || clientNameMatch;
      });
    }

    if (secretsReady) {
      result.sort((a, b) => {
        const aIsOrphan = !existingSecretsSet.has(a.pppoe_secret_name);
        const bIsOrphan = !existingSecretsSet.has(b.pppoe_secret_name);
        if (aIsOrphan && !bIsOrphan) return -1;
        if (!aIsOrphan && bIsOrphan) return 1;
        return a.pppoe_secret_name.localeCompare(b.pppoe_secret_name);
      });
    } else {
      result.sort((a, b) => a.pppoe_secret_name.localeCompare(b.pppoe_secret_name));
    }

    return result;
  }, [clients, searchQuery, secretsReady, existingSecretsSet]);

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
    window.addEventListener('collapse-client-list', handleForceCollapse);

    return () => {
      mq.removeEventListener('change', handler);
      window.removeEventListener('collapse-client-list', handleForceCollapse);
    };
  }, []);

  useEffect(() => {
    if (!isSelectMode) setSelectedIds(new Set());
  }, [isSelectMode]);

  const allFilteredSelected = filteredClients.length > 0 && filteredClients.every(c => selectedIds.has(c.id));

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        filteredClients.forEach(c => next.delete(c.id));
        return next;
      });
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev);
        filteredClients.forEach(c => next.add(c.id));
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
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => {
            if (!isSelectMode) {
              const willExpand = isCollapsed;
              setIsCollapsed(!willExpand);
              if (willExpand) {
                window.dispatchEvent(new CustomEvent('collapse-asset-list'));
              }
            }
          }}>
            <CardTitle className="text-base lg:text-lg whitespace-nowrap">Client ({filteredClients.length})</CardTitle>
            <button className="lg:hidden text-muted-foreground" aria-label="Toggle">
              {isCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
            </button>
          </div>

          <div className="flex items-center gap-1 flex-1 justify-end">
            {!isSelectMode && onSearchChange && (
              showSearch ? (
                <div className="relative flex-1 w-full max-w-[180px] sm:max-w-[240px]">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    ref={searchInputRef}
                    type="text"
                    placeholder="Cari client..."
                    value={searchQuery}
                    autoFocus
                    onClick={() => {
                      setIsCollapsed(false);
                      window.dispatchEvent(new CustomEvent('collapse-asset-list'));
                    }}
                    onBlur={() => { if (!searchQuery) setShowSearch(false); }}
                    onChange={(e) => {
                      setIsCollapsed(false);
                      window.dispatchEvent(new CustomEvent('collapse-asset-list'));
                      onSearchChange(e.target.value);
                    }}
                    className="pl-8 pr-7 bg-input text-sm h-8"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onMouseDown={(e) => e.preventDefault()} // Prevent blur on input
                      onClick={() => {
                        if (onSearchChange) onSearchChange('');
                        setIsCollapsed(false);
                        window.dispatchEvent(new CustomEvent('collapse-asset-list'));
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
                  variant="ghost"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  title="Cari Client"
                  onClick={() => {
                    setShowSearch(true);
                    setIsCollapsed(false);
                    window.dispatchEvent(new CustomEvent('collapse-asset-list'));
                  }}
                >
                  <Search size={15} />
                </Button>
              )
            )}

            {onBulkDelete && (
              <>
                {isSelectMode ? (
                  <div className="flex items-center gap-1">
                    {selectedIds.size > 0 && (
                      <Button
                        size="icon"
                        variant="destructive"
                        className="h-8 w-8 relative"
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
                      className="h-8 w-8"
                      title="Batal"
                      onClick={() => setIsSelectMode(false)}
                    >
                      ✕
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-destructive hover:bg-destructive/10"
                    title="Pilih & Hapus Client"
                    onClick={() => { setIsSelectMode(true); setIsCollapsed(false); }}
                  >
                    <Trash2 size={15} />
                  </Button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Select All bar */}
        {isSelectMode && !isCollapsed && filteredClients.length > 0 && (
          <button
            onClick={toggleSelectAll}
            className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full px-1"
          >
            {allFilteredSelected
              ? <CheckSquare size={15} className="text-primary" />
              : <Square size={15} />
            }
            {allFilteredSelected ? 'Batal Pilih Semua' : `Pilih Semua (${filteredClients.length})`}
          </button>
        )}
      </CardHeader>

      {!isCollapsed && (
        <CardContent className="flex-grow overflow-y-auto p-1.5 max-h-[240px] lg:max-h-none">
          {loading ? (
            <div className="flex justify-center items-center h-full"><Loader2 className="animate-spin h-6 w-6 text-muted-foreground" /></div>
          ) : filteredClients.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-4">
              <p className="text-muted-foreground text-sm">
                {searchQuery ? 'Tidak ada client yang sesuai dengan pencarian' : 'Tidak ada client'}
              </p>
            </div>
          ) : (
            <ul className="space-y-1.5">
              {filteredClients.map(client => {
                const isSelected = selectedClientId === client.id;
                const isChecked = selectedIds.has(client.id);
                return (
                  <li key={client.id}>
                    <div
                      className={`w-full flex items-center gap-2 lg:gap-3 p-2 lg:p-3 rounded-lg text-left transition-all duration-200 cursor-pointer ${isSelectMode
                        ? isChecked
                          ? 'bg-destructive/10 ring-2 ring-destructive/50'
                          : 'hover:bg-secondary'
                        : isSelected
                          ? 'bg-primary/10 ring-2 ring-primary'
                          : 'hover:bg-secondary'
                        }`}
                      onClick={() => {
                        if (isSelectMode) toggleItem(client.id);
                        else onClientSelect(client);
                      }}
                      onDoubleClick={() => !isSelectMode && onClientView?.(client)}
                    >
                      {isSelectMode && (
                        <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
                          {isChecked
                            ? <CheckSquare size={18} className="text-destructive" />
                            : <Square size={18} className="text-muted-foreground" />
                          }
                        </div>
                      )}
                      <div className={`flex-shrink-0 w-8 h-8 lg:w-10 lg:h-10 rounded-lg flex items-center justify-center text-white bg-purple-500 ${isSelectMode ? 'opacity-70' : ''}`}>
                        <User size={16} />
                      </div>
                      <div className="flex-grow overflow-hidden">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold truncate text-sm lg:text-base">{client.pppoe_secret_name}</p>
                          {secretsReady && !existingSecretsSet.has(client.pppoe_secret_name) && (
                            <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold bg-destructive text-destructive-foreground">
                              ORPHAN
                            </span>
                          )}
                        </div>
                        {client.odp_name ? (
                          <p className="text-sm text-muted-foreground">ODP: {client.odp_name}</p>
                        ) : (
                          <p className="text-sm text-muted-foreground">Belum terhubung ke ODP</p>
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

export default ClientList;
