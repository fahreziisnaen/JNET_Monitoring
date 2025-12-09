'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface LegendItem {
  label: string;
  icon: React.ReactNode;
  color?: string;
}

const MapLegend = () => {
  const [isMinimized, setIsMinimized] = useState(false);

  const equipmentItems: LegendItem[] = [
    { label: 'Mikrotik', icon: <div className="w-4 h-4 rounded-full" style={{ backgroundColor: '#06b6d4' }} /> },
    { label: 'OLT', icon: <div className="w-4 h-4 rounded-full bg-amber-500" /> },
    { label: 'ODC', icon: <div className="w-4 h-4 rounded-full" style={{ backgroundColor: '#a855f7' }} /> },
    { label: 'ODP', icon: <div className="w-4 h-4 rounded-full" style={{ backgroundColor: '#3b82f6' }} /> },
  ];

  const lineStatusItems: LegendItem[] = [
    { label: 'Terpasang', icon: <div className="w-8 h-0.5 bg-green-500" />, color: '#10b981' },
    { label: 'Rencana', icon: <div className="w-8 h-0.5 bg-blue-500" />, color: '#3b82f6' },
    { label: 'Maintenance', icon: <div className="w-8 h-0.5 bg-yellow-500" />, color: '#eab308' },
    { label: 'Putus', icon: <div className="w-8 h-0.5 bg-red-500" />, color: '#ef4444' },
  ];

  return (
    <Card className="absolute left-4 top-4 z-[1000] w-64 bg-background/95 backdrop-blur-sm shadow-lg">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">Legend</CardTitle>
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
            <h4 className="text-xs font-semibold mb-2 text-muted-foreground">Equipment</h4>
            <div className="space-y-1.5">
              {equipmentItems.map((item) => (
                <div key={item.label} className="flex items-center gap-2 text-xs">
                  {item.icon}
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
          </div>
          
          <div>
            <h4 className="text-xs font-semibold mb-2 text-muted-foreground">Line Status</h4>
            <div className="space-y-1.5">
              {lineStatusItems.map((item) => (
                <div key={item.label} className="flex items-center gap-2 text-xs">
                  {item.icon}
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
};

export default MapLegend;

