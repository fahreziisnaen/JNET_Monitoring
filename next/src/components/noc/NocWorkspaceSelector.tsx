'use client';

import React, { useState, useEffect } from 'react';
import { ArrowRightLeft, Check, ChevronDown, CheckCircle2, ChevronUp, Loader2 } from 'lucide-react';
import { useAuth } from '../providers/auth-provider';

interface Workspace {
    id: number;
    name: string;
}

interface NocWorkspaceSelectorProps {
    selectedWorkspaceIds: number[];
    onChange: (ids: number[]) => void;
    onWorkspacesFetched?: (workspaces: Workspace[]) => void;
}

const NocWorkspaceSelector: React.FC<NocWorkspaceSelectorProps> = ({ selectedWorkspaceIds, onChange, onWorkspacesFetched }) => {
    const { token, user } = useAuth();
    const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if ((user?.is_super_admin || user?.role === 'noc' || user?.role === 'admin') && token) {
            fetchWorkspaces();
        }
    }, [user, token]);

    const fetchWorkspaces = async () => {
        setIsLoading(true);
        try {
            const endpoint = (user?.role === 'noc' || user?.role === 'admin') ? '/api/noc/my-workspaces' : '/api/workspaces/all';
            const response = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}${endpoint}`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            if (response.ok) {
                const data = await response.json();
                setWorkspaces(data);
                if (onWorkspacesFetched) onWorkspacesFetched(data);

                // Pilih semua workspace secara default jika belum ada yang terpilih
                if (selectedWorkspaceIds.length === 0 && data.length > 0) {
                    onChange(data.map((w: Workspace) => w.id));
                }
            }
        } catch (error) {
            console.error("Failed to fetch workspaces", error);
        } finally {
            setIsLoading(false);
        }
    };

    const toggleWorkspace = (id: number) => {
        if (selectedWorkspaceIds.includes(id)) {
            onChange(selectedWorkspaceIds.filter(wId => wId !== id));
        } else {
            onChange([...selectedWorkspaceIds, id]);
        }
    };

    const selectAll = () => {
        onChange(workspaces.map(w => w.id));
    };

    const deselectAll = () => {
        onChange([]);
    };

    return (
        <div className="relative w-full">
            <label className="text-xs sm:text-sm font-semibold mb-1.5 sm:mb-2 block">Pilih Workspace</label>

            <div
                onClick={() => setIsOpen(!isOpen)}
                className="w-full bg-card border border-border rounded-lg p-2 sm:p-3 flex justify-between items-center cursor-pointer hover:border-primary/50 transition-colors h-[40px] sm:h-[44px]"
            >
                <div className="flex items-center gap-1.5 sm:gap-2 overflow-hidden">
                    {isLoading ? <Loader2 className="animate-spin text-primary w-4 h-4 sm:w-5 sm:h-5 shrink-0" /> : <ArrowRightLeft className="text-muted-foreground w-4 h-4 sm:w-5 sm:h-5 shrink-0" />}
                    <span className="font-medium text-xs sm:text-sm truncate">
                        {selectedWorkspaceIds.length === workspaces.length
                            ? 'Semua'
                            : `${selectedWorkspaceIds.length} Terpilih`}
                    </span>
                </div>
                {isOpen ? <ChevronUp className="w-4 h-4 sm:w-5 sm:h-5 shrink-0 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 sm:w-5 sm:h-5 shrink-0 text-muted-foreground" />}
            </div>

            {isOpen && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-card border border-border rounded-lg shadow-xl z-50 max-h-80 flex flex-col">
                    <div className="p-2 border-b flex gap-2">
                        <button
                            onClick={(e) => { e.stopPropagation(); selectAll(); }}
                            className="text-xs px-3 py-1.5 bg-secondary hover:bg-secondary/80 rounded-md flex-1 transition-colors"
                        >
                            Pilih Semua
                        </button>
                        <button
                            onClick={(e) => { e.stopPropagation(); deselectAll(); }}
                            className="text-xs px-3 py-1.5 bg-secondary hover:bg-secondary/80 rounded-md flex-1 transition-colors"
                        >
                            Hapus Semua Pilihan
                        </button>
                    </div>

                    <div className="overflow-y-auto p-2 space-y-1 custom-scrollbar">
                        {workspaces.map(ws => {
                            const isSelected = selectedWorkspaceIds.includes(ws.id);
                            return (
                                <div
                                    key={ws.id}
                                    onClick={(e) => { e.stopPropagation(); toggleWorkspace(ws.id); }}
                                    className={`flex items-center justify-between p-2 rounded-md cursor-pointer transition-colors ${isSelected ? 'bg-primary/10 hover:bg-primary/20' : 'hover:bg-secondary'}`}
                                >
                                    <span className={isSelected ? 'font-medium text-primary' : ''}>{ws.name}</span>
                                    {isSelected && <CheckCircle2 className="w-4 h-4 text-primary" />}
                                </div>
                            )
                        })}
                        {workspaces.length === 0 && (
                            <div className="text-center p-4 text-sm text-muted-foreground">
                                Tidak ada workspace ditemukan.
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default NocWorkspaceSelector;
