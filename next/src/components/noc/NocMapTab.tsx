'use client';

import React from 'react';
import LocationManager from '@/components/location/LocationManager';

interface NocMapTabProps {
    workspaceIds: number[];
}

const NocMapTab: React.FC<NocMapTabProps> = ({ workspaceIds }) => {
    return (
        <div className="h-[calc(100vh-320px)] min-h-[500px] lg:h-[850px] -mx-4 md:mx-0 border-y md:border md:rounded-xl overflow-hidden bg-background">
            {workspaceIds.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full bg-secondary/50">
                    <h2 className="text-xl font-bold mb-2">Tidak ada data peta</h2>
                    <p className="text-muted-foreground">Pilih setidaknya satu workspace yang memiliki perangkat atau klien.</p>
                </div>
            ) : (
                <LocationManager
                    isNocMode={true}
                    nocWorkspaceIds={workspaceIds}
                />
            )}
        </div>
    );
};

export default NocMapTab;
