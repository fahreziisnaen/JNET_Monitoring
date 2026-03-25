'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/components/providers/auth-provider';
import { useRouter } from 'next/navigation';
import { Activity, Map } from 'lucide-react';
import NocWorkspaceSelector from '@/components/noc/NocWorkspaceSelector';
import NocManagementTab from '@/components/noc/NocManagementTab';
import NocMapTab from '@/components/noc/NocMapTab';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useMikrotik } from '@/components/providers/mikrotik-provider';

interface Workspace {
    id: number;
    name: string;
}

const NocPage = () => {
    usePageTitle('NOC');
    const { user } = useAuth();
    const { setNocWorkspaceIds } = useMikrotik();
    const router = useRouter();

    const [allWorkspaces, setAllWorkspaces] = useState<Workspace[]>([]);
    const [selectedWorkspaceIds, setSelectedWorkspaceIds] = useState<number[]>([]);
    const [activeTab, setActiveTab] = useState<'management' | 'map'>('management');
    const [isInitialized, setIsInitialized] = useState(false);

    // Initial load from localStorage
    useEffect(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('noc_selected_workspaces');
            if (saved) {
                try {
                    setSelectedWorkspaceIds(JSON.parse(saved));
                } catch (e) {}
            }
            setIsInitialized(true);
        }
    }, []);

    // Sync NOC selection to MikrotikProvider for WebSocket management and save to storage
    useEffect(() => {
        setNocWorkspaceIds(selectedWorkspaceIds);
        if (isInitialized && typeof window !== 'undefined') {
            localStorage.setItem('noc_selected_workspaces', JSON.stringify(selectedWorkspaceIds));
        }
    }, [selectedWorkspaceIds, setNocWorkspaceIds, isInitialized]);

    const handleWorkspacesFetched = (workspaces: Workspace[]) => {
        setAllWorkspaces(workspaces);
        
        // Auto-select ONLY if it's the first time ever loading NOC dashboard (no saved config)
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('noc_selected_workspaces');
            if (!saved && workspaces.length > 0) {
                const allIds = workspaces.map(w => w.id);
                setSelectedWorkspaceIds(allIds);
                localStorage.setItem('noc_selected_workspaces', JSON.stringify(allIds));
            }
        }
    };

    const activeWorkspaces = allWorkspaces.filter(ws => selectedWorkspaceIds.includes(ws.id));

    // Proteksi rute NOC hanya untuk superadmin dan role noc
    useEffect(() => {
        if (user === null) {
            router.push('/login');
        } else if (user && !user.is_super_admin && user.role !== 'noc' && user.role !== 'admin') {
            router.push('/dashboard');
        }
    }, [user, router]);

    if (!user?.is_super_admin && user?.role !== 'noc' && user?.role !== 'admin') {
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
                        onWorkspacesFetched={handleWorkspacesFetched}
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
