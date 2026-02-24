'use client';

import React, { useState, useEffect } from 'react';
import { User, Loader2, Search, ChevronDown, ChevronUp } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export interface Client {
  id: number;
  pppoe_secret_name: string;
  latitude: number;
  longitude: number;
  client_name?: string | null;
  whatsapp_number?: string | null;
  odp_asset_id: number | null;
  odp_name?: string | null;
  odp_owner_name?: string | null; // Owner dari ODP yang terhubung
  isActive?: boolean; // Status aktif dari PPPoE
  isOffline?: boolean;
  created_at?: string;
  updated_at?: string;
  connection_path?: string | [number, number][];
  photo_url?: string | null;
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
}

const ClientList = ({ clients, loading, selectedClientId, onClientSelect, onClientView, searchQuery = '', onSearchChange, pppoeSecrets }: ClientListProps) => {
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

    // Sort: Orphan first, then alphabetical
    if (pppoeSecrets && pppoeSecrets.length > 0) {
      result.sort((a, b) => {
        const aIsOrphan = !existingSecretsSet.has(a.pppoe_secret_name);
        const bIsOrphan = !existingSecretsSet.has(b.pppoe_secret_name);

        if (aIsOrphan && !bIsOrphan) return -1;
        if (!aIsOrphan && bIsOrphan) return 1;

        return a.pppoe_secret_name.localeCompare(b.pppoe_secret_name);
      });
    } else {
      // Default alphabetical sort if no pppoeSecrets for comparison
      result.sort((a, b) => a.pppoe_secret_name.localeCompare(b.pppoe_secret_name));
    }

    return result;
  }, [clients, searchQuery, pppoeSecrets, existingSecretsSet]);

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
    window.addEventListener('collapse-client-list', handleForceCollapse);

    return () => {
      mq.removeEventListener('change', handler);
      window.removeEventListener('collapse-client-list', handleForceCollapse);
    };
  }, []);

  return (
    <Card className={`flex flex-col transition-all duration-300 ${isCollapsed ? 'flex-shrink-0' : 'flex-1 min-h-0'}`}>
      <CardHeader className="pb-2 px-3 py-2 lg:px-6 lg:py-3 lg:cursor-default">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => setIsCollapsed(prev => !prev)}>
            <CardTitle className="text-base lg:text-lg whitespace-nowrap">Daftar Client ({filteredClients.length})</CardTitle>
            <button className="lg:hidden text-muted-foreground" aria-label="Toggle">
              {isCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
            </button>
          </div>
          {onSearchChange && (
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Cari client..."
                value={searchQuery}
                onClick={() => setIsCollapsed(false)}
                onFocus={() => {
                  setIsCollapsed(false);
                  window.dispatchEvent(new CustomEvent('collapse-asset-list'));
                }}
                onChange={(e) => {
                  setIsCollapsed(false);
                  window.dispatchEvent(new CustomEvent('collapse-asset-list'));
                  onSearchChange(e.target.value);
                }}
                className="pl-8 bg-input text-sm h-8"
              />
            </div>
          )}
        </div>
      </CardHeader>
      {!isCollapsed && (
        <CardContent className="flex-grow overflow-y-auto p-1.5 max-h-[120px] lg:max-h-none">
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
                return (
                  <li key={client.id}>
                    <button
                      onClick={() => onClientSelect(client)}
                      onDoubleClick={() => onClientView?.(client)}
                      className={`w-full flex items-center gap-2 lg:gap-3 p-2 lg:p-3 rounded-lg text-left transition-all duration-200 ${isSelected ? 'bg-primary/10 ring-2 ring-primary' : 'hover:bg-secondary'}`}
                    >
                      <div className="flex-shrink-0 w-8 h-8 lg:w-10 lg:h-10 rounded-lg flex items-center justify-center text-white bg-purple-500">
                        <User size={16} />
                      </div>
                      <div className="flex-grow overflow-hidden">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold truncate text-sm lg:text-base">{client.pppoe_secret_name}</p>
                          {pppoeSecrets && pppoeSecrets.length > 0 && !existingSecretsSet.has(client.pppoe_secret_name) && (
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
                    </button>
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

