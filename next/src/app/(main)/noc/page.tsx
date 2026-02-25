'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/components/providers/auth-provider';
import { useRouter } from 'next/navigation';
import { Activity, Map } from 'lucide-react';
import NocWorkspaceSelector from '@/components/noc/NocWorkspaceSelector';
import NocManagementTab from '@/components/noc/NocManagementTab';
import NocMapTab from '@/components/noc/NocMapTab';

const NocPage = () => {
    const { user } = useAuth();
    const router = useRouter();

    const [selectedWorkspaceIds, setSelectedWorkspaceIds] = useState<number[]>([]);
    const [activeTab, setActiveTab] = useState<'management' | 'map'>('management');

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

            <NocWorkspaceSelector
                selectedWorkspaceIds={selectedWorkspaceIds}
                onChange={setSelectedWorkspaceIds}
            />

            <div className="bg-card border rounded-lg p-1 flex mb-6 max-w-sm">
                <button
                    onClick={() => setActiveTab('management')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-md text-sm font-medium transition-all ${activeTab === 'management'
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-muted-foreground hover:bg-secondary'
                        }`}
                >
                    <Activity className="w-4 h-4" />
                    Manajemen
                </button>
                <button
                    onClick={() => setActiveTab('map')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-md text-sm font-medium transition-all ${activeTab === 'map'
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-muted-foreground hover:bg-secondary'
                        }`}
                >
                    <Map className="w-4 h-4" />
                    Peta
                </button>
            </div>

            {activeTab === 'management' ? (
                <NocManagementTab workspaceIds={selectedWorkspaceIds} />
            ) : (
                <NocMapTab workspaceIds={selectedWorkspaceIds} />
            )}
        </div>
    );
};

export default NocPage;
