'use client';

import React from 'react';
import { Server, AlertCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

interface NoDeviceMessageProps {
  title?: string;
  description?: string;
}

export const NoDeviceMessage: React.FC<NoDeviceMessageProps> = ({
  title = 'Mikrotik Belum Terdaftar',
  description = 'Silakan tambahkan perangkat Mikrotik terlebih dahulu di halaman Settings untuk mulai menggunakan fitur ini.'
}) => {
  return (
    <div className="flex items-center justify-center min-h-[400px] p-8">
      <Card className="w-full max-w-md">
        <CardContent className="p-8 text-center">
          <div className="flex justify-center mb-4">
            <div className="rounded-full bg-muted p-4">
              <Server className="h-12 w-12 text-muted-foreground" />
            </div>
          </div>
          <h3 className="text-xl font-semibold mb-2">{title}</h3>
          <p className="text-muted-foreground mb-4">{description}</p>
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <AlertCircle className="h-4 w-4" />
            <span>Belum ada perangkat Mikrotik yang aktif</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

