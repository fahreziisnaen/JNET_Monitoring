'use client';

import React from 'react';
import { User, Loader2, Search } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export interface Client {
  id: number;
  pppoe_secret_name: string;
  latitude: number;
  longitude: number;
  odp_asset_id: number | null;
  odp_name?: string | null;
  odp_owner_name?: string | null; // Owner dari ODP yang terhubung
  isActive?: boolean; // Status aktif dari PPPoE
  created_at?: string;
  updated_at?: string;
}

interface ClientListProps {
  clients: Client[];
  loading: boolean;
  selectedClientId?: number | null;
  onClientSelect: (client: Client) => void;
  onClientView?: (client: Client) => void;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
}

const ClientList = ({ clients, loading, selectedClientId, onClientSelect, onClientView, searchQuery = '', onSearchChange }: ClientListProps) => {
  const filteredClients = React.useMemo(() => {
    if (!searchQuery.trim()) return clients;
    
    const query = searchQuery.toLowerCase().trim();
    return clients.filter(client => {
      const nameMatch = client.pppoe_secret_name.toLowerCase().includes(query);
      const odpMatch = client.odp_name?.toLowerCase().includes(query);
      return nameMatch || odpMatch;
    });
  }, [clients, searchQuery]);

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="mb-2 text-2xl">Daftar Client ({filteredClients.length})</CardTitle>
        {onSearchChange && (
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Cari client..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-8 bg-input text-sm h-8"
            />
          </div>
        )}
      </CardHeader>
      <CardContent className="flex-grow overflow-y-auto p-1.5">
        {loading ? (
          <div className="flex justify-center items-center h-full"><Loader2 className="animate-spin h-6 w-6 text-muted-foreground"/></div>
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
                    className={`w-full flex items-center gap-3 p-3 rounded-lg text-left transition-all duration-200 ${isSelected ? 'bg-primary/10 ring-2 ring-primary' : 'hover:bg-secondary'}`}
                  >
                    <div className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-white bg-purple-500">
                      <User size={20} />
                    </div>
                    <div className="flex-grow overflow-hidden">
                      <p className="font-semibold truncate text-base">{client.pppoe_secret_name}</p>
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
    </Card>
  );
};

export default ClientList;

