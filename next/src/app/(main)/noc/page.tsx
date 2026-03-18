'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/components/providers/auth-provider';
import { useRouter } from 'next/navigation';
import { Activity, Map } from 'lucide-react';
import NocWorkspaceSelector from '@/components/noc/NocWorkspaceSelector';
import NocManagementTab from '@/components/noc/NocManagementTab';
import NocMapTab from '@/components/noc/NocMapTab';
import { usePageTitle } from '@/hooks/usePageTitle';

interface Workspace {
    id: number;
    name: string;
}

const NocPage = () => {
    usePageTitle('NOC');
    const { user } = useAuth();
    const router = useRouter();

    const [allWorkspaces, setAllWorkspaces] = useState<Workspace[]>([]);
    const [selectedWorkspaceIds, setSelectedWorkspaceIds] = useState<number[]>([]);
    const [activeTab, setActiveTab] = useState<'management' | 'map'>('management');

    const activeWorkspaces = allWorkspaces.filter(ws => selectedWorkspaceIds.includes(ws.id));

    // Proteksi rute NOC hanya untuk superadmin
    useEffect(() => {
        if (user === null) {
            router.push('/login');
        } else if (user && !user.is_super_admin) {
            router.push('/dashboard');
        }
    }, [user, router]);

    if (!user?.is_super_admin) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <p className="text-muted-foreground animate-pulse">Memuat Network Operations Center...</p>
            </div>
        );
    }

    return (
        <div className="p-4 md:p-8 max-w-[1600px] mx-auto">
            <div className="flex flex-col mb-8">
                <h1 className="text-3xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
                    Network Operations Center (NOC)
                </h1>
                <p className="text-muted-foreground mt-2">
                    Pusat pemantauan terpadu untuk semua workspace yang Anda kelola.
                </p>
            </div>

            <div className="flex flex-row items-end justify-between gap-3 sm:gap-4 mb-6">
                <div className="flex-1 min-w-0 max-w-[400px]">
                    <NocWorkspaceSelector
                        selectedWorkspaceIds={selectedWorkspaceIds}
                        onChange={setSelectedWorkspaceIds}
                        onWorkspacesFetched={setAllWorkspaces}
                    />
                </div>

                <div className="bg-card border rounded-lg p-1 flex shrink-0">
                    <button
                        onClick={() => setActiveTab('management')}
                        className={`flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-md text-sm font-medium transition-all ${activeTab === 'management'
                            ? 'bg-primary text-primary-foreground shadow-sm'
                            : 'text-muted-foreground hover:bg-secondary'
                            }`}
                    >
                        <Activity className="w-5 h-5 sm:w-4 sm:h-4" />
                        <span className="hidden sm:inline">Manajemen</span>
                    </button>
                    <button
                        onClick={() => setActiveTab('map')}
                        className={`flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-md text-sm font-medium transition-all ${activeTab === 'map'
                            ? 'bg-primary text-primary-foreground shadow-sm'
                            : 'text-muted-foreground hover:bg-secondary'
                            }`}
                    >
                        <Map className="w-5 h-5 sm:w-4 sm:h-4" />
                        <span className="hidden sm:inline">Peta</span>
                    </button>
                </div>
            </div>

            {activeTab === 'management' ? (
                <NocManagementTab workspaces={activeWorkspaces} />
            ) : (
                <NocMapTab workspaces={activeWorkspaces} />
            )}
        </div>
    );
};

export default NocPage;
