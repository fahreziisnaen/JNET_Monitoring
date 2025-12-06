'use client';

import React from 'react';
import { Server, Box, GitBranch, Share2, RadioTower } from 'lucide-react';
import { cn } from '@/lib/utils';

export const assetTypes = [
  { id: 'Mikrotik', name: 'Mikrotik', icon: <RadioTower size={16} /> },
  { id: 'OLT', name: 'OLT', icon: <Server size={16} /> },
  { id: 'ODC', name: 'ODC', icon: <Box size={16} /> },
  { id: 'ODP', name: 'ODP', icon: <GitBranch size={16} /> },
];

interface AssetFilterProps {
  visibleTypes: Set<string>;
  onToggleType: (type: string) => void;
}

const AssetFilter = ({ visibleTypes, onToggleType }: AssetFilterProps) => {
  return (
    <div className="flex flex-wrap gap-2 p-2 bg-secondary rounded-lg">
      {assetTypes.map((type) => {
        const isVisible = visibleTypes.has(type.id);
        return (
          <button
            key={type.id}
            onClick={() => onToggleType(type.id)}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-md transition-all",
              isVisible
                ? 'bg-primary text-primary-foreground shadow'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            )}
          >
            {type.icon}
            {type.name}
          </button>
        );
      })}
    </div>
  );
};

export default AssetFilter;