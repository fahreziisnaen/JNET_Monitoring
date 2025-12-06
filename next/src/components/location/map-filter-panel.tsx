'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { ChevronUp, ChevronDown, User } from 'lucide-react';
import { assetTypes } from './asset-filter';
import { cn } from '@/lib/utils';

interface MapFilterPanelProps {
  visibleTypes: Set<string>;
  onTypeToggle: (type: string) => void;
  showLines: boolean;
  onToggleLines: (show: boolean) => void;
  onToggleAll: () => void;
  visibleOwners?: Set<string>;
  availableOwners?: string[];
  onOwnerToggle?: (owner: string) => void;
  onToggleAllOwners?: () => void;
  showClients?: boolean;
  onToggleClients?: (show: boolean) => void;
}

const MapFilterPanel = ({
  visibleTypes,
  onTypeToggle,
  showLines,
  onToggleLines,
  onToggleAll,
  visibleOwners = new Set(),
  availableOwners = [],
  onOwnerToggle,
  onToggleAllOwners,
  showClients = true,
  onToggleClients,
}: MapFilterPanelProps) => {
  const [isMinimized, setIsMinimized] = useState(false);
  const allTypesVisible = assetTypes.every(t => visibleTypes.has(t.id));
  const allOwnersVisible = availableOwners.length > 0 && availableOwners.every(o => visibleOwners.has(o));

  return (
    <Card className="absolute right-4 top-4 z-[1000] w-64 bg-background/95 backdrop-blur-sm shadow-lg">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">Filter View</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={() => setIsMinimized(!isMinimized)}
          >
            {isMinimized ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </Button>
        </div>
      </CardHeader>
      {!isMinimized && (
        <CardContent className="space-y-4">
          <div>
            <h4 className="text-xs font-semibold mb-2 text-muted-foreground">Equipment Type</h4>
            <div className="space-y-2">
              {assetTypes.map((type) => (
                <div key={type.id} className="flex items-center gap-2">
                  <Checkbox
                    id={`filter-${type.id}`}
                    checked={visibleTypes.has(type.id)}
                    onCheckedChange={() => onTypeToggle(type.id)}
                  />
                  <label
                    htmlFor={`filter-${type.id}`}
                    className="text-xs cursor-pointer flex items-center gap-2"
                  >
                    {type.icon}
                    {type.name}
                  </label>
                </div>
              ))}
            </div>
          </div>

          {availableOwners.length > 0 && onOwnerToggle && (
            <div>
              <h4 className="text-xs font-semibold mb-2 text-muted-foreground">Pemilik Aset</h4>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {availableOwners.map((owner) => (
                  <div key={owner} className="flex items-center gap-2">
                    <Checkbox
                      id={`filter-owner-${owner}`}
                      checked={visibleOwners.has(owner)}
                      onCheckedChange={() => onOwnerToggle(owner)}
                    />
                    <label
                      htmlFor={`filter-owner-${owner}`}
                      className="text-xs cursor-pointer flex items-center gap-2"
                    >
                      <User size={12} />
                      {owner}
                    </label>
                  </div>
                ))}
              </div>
              {onToggleAllOwners && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-xs mt-2 h-6"
                  onClick={onToggleAllOwners}
                >
                  {allOwnersVisible ? 'Hapus Semua' : 'Pilih Semua'}
                </Button>
              )}
            </div>
          )}

          <div>
            <h4 className="text-xs font-semibold mb-2 text-muted-foreground">Display</h4>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="filter-lines"
                  checked={showLines}
                  onCheckedChange={onToggleLines}
                />
                <label
                  htmlFor="filter-lines"
                  className="text-xs cursor-pointer"
                >
                  Show Lines
                </label>
              </div>
              {onToggleClients && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="filter-clients"
                    checked={showClients}
                    onCheckedChange={onToggleClients}
                  />
                  <label
                    htmlFor="filter-clients"
                    className="text-xs cursor-pointer flex items-center gap-2"
                  >
                    <User size={12} />
                    Show Clients
                  </label>
                </div>
              )}
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            className="w-full text-xs"
            onClick={onToggleAll}
          >
            {allTypesVisible ? 'Hide All' : 'Show All'}
          </Button>
        </CardContent>
      )}
    </Card>
  );
};

export default MapFilterPanel;

