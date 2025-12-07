'use client';

import React, { useEffect, useState, useMemo, useRef } from 'react';
import { Line } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend } from 'chart.js';
import { useMikrotik } from '@/components/providers/mikrotik-provider';
import { useAuth } from '@/components/providers/auth-provider';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Loader2, Filter, GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

const EtherChart = ({ trafficData, interfaceName }: { trafficData: any; interfaceName: string }) => {
  const { user } = useAuth();
  const workspaceId = user?.workspace_id || 'default';
  const storageKey = `chart-data-${workspaceId}-${interfaceName}`;
  // Tidak ada batasan waktu - data grafik tetap tersimpan meskipun logout lama
  // Polling cron job tetap berjalan di background untuk update dashboard_snapshot
  
  // Load saved data from localStorage on mount
  // Data grafik tetap tersimpan tanpa batasan waktu karena polling cron job
  // terus berjalan di background untuk update dashboard_snapshot
  const loadSavedData = () => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Return data yang tersimpan tanpa cek gap waktu
        // Polling cron job tetap berjalan, jadi data bisa dilanjutkan kapan saja
        if (parsed.data) {
          return parsed.data;
        }
      }
    } catch (e) {
      console.warn('Failed to load saved chart data:', e);
      localStorage.removeItem(storageKey);
    }
    return null;
  };

  const initialData = loadSavedData() || {
    labels: Array(30).fill(''),
    datasets: [
      { label: 'Upload (Mbps)', data: Array(30).fill(0), borderColor: '#ef4444', backgroundColor: '#ef444433', tension: 0.4, pointRadius: 0 },
      { label: 'Download (Mbps)', data: Array(30).fill(0), borderColor: '#3b82f6', backgroundColor: '#3b82f633', tension: 0.4, pointRadius: 0 },
    ],
  };

  const [chartData, setChartData] = useState(initialData);
  const lastUpdateRef = useRef<number | null>(null);
  const isInitializedRef = useRef(false);

  // Initialize chart data from localStorage on mount
  useEffect(() => {
    if (!isInitializedRef.current) {
      const saved = loadSavedData();
      if (saved) {
        setChartData(saved);
        // Set lastUpdateRef to prevent immediate update saat data baru masuk
        try {
          const savedItem = localStorage.getItem(storageKey);
          if (savedItem) {
            const parsed = JSON.parse(savedItem);
            lastUpdateRef.current = parsed.lastUpdate || Date.now();
          }
        } catch (e) {
          // Ignore error
        }
      }
      isInitializedRef.current = true;
    }
  }, [storageKey]);

  useEffect(() => {
    if (trafficData && isInitializedRef.current) {
      const txBps = parseFloat(trafficData['tx-bits-per-second'] || '0');
      const rxBps = parseFloat(trafficData['rx-bits-per-second'] || '0');
      const txMbps = parseFloat((txBps / 1000000).toFixed(2));
      const rxMbps = parseFloat((rxBps / 1000000).toFixed(2));
      const now = Date.now();

      setChartData((prevData: typeof initialData) => {
        // Skip jika update terlalu cepat (< 2 detik) untuk menghindari duplicate saat load
        if (lastUpdateRef.current && now - lastUpdateRef.current < 2000) {
          return prevData;
        }
        
        lastUpdateRef.current = now;
        
        const newData = {
        labels: [...prevData.labels.slice(1), new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })],
        datasets: [
          { ...prevData.datasets[0], data: [...(prevData.datasets[0].data as number[]).slice(1), txMbps] },
          { ...prevData.datasets[1], data: [...(prevData.datasets[1].data as number[]).slice(1), rxMbps] },
        ]
        };
        
        // Save to localStorage setiap update
        try {
          localStorage.setItem(storageKey, JSON.stringify({
            data: newData,
            lastUpdate: now
          }));
        } catch (e) {
          console.warn('Failed to save chart data:', e);
        }
        
        return newData;
      });
    }
  }, [trafficData, storageKey]);

  const chartOptions: any = { responsive: true, maintainAspectRatio: false, animation: { duration: 400 }, scales: { y: { beginAtZero: true, ticks: { callback: (value: number) => `${value} Mbps` } } }, plugins: { legend: { position: 'top' as const } } };

  return <Line data={chartData} options={chartOptions} />;
};

// Sortable Item Component untuk Interface Card
interface SortableInterfaceCardProps {
  id: string;
  etherId: string;
  currentTraffic: any;
  index: number;
  itemCount: number;
}

const SortableInterfaceCard = ({ id, etherId, currentTraffic, index, itemCount }: SortableInterfaceCardProps) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const txBps = parseFloat(currentTraffic?.['tx-bits-per-second'] || '0');
  const rxBps = parseFloat(currentTraffic?.['rx-bits-per-second'] || '0');
  const txMbps = parseFloat((txBps / 1000000).toFixed(2));
  const rxMbps = parseFloat((rxBps / 1000000).toFixed(2));
  const glowClass = txBps > rxBps ? 'shadow-glow-red' : 'shadow-glow-blue';
  const isLastAndOdd = (index === itemCount - 1) && (itemCount % 2 !== 0) && (itemCount >= 3);

  // Format angka dengan baik
  const formatSpeed = (mbps: number) => {
    if (mbps >= 1000) {
      return `${(mbps / 1000).toFixed(2)} Gbps`;
    }
    return `${mbps.toFixed(2)} Mbps`;
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'transition-all duration-500',
        isLastAndOdd && 'md:col-span-2'
      )}
    >
      <Card 
        className={cn(
          'transition-all duration-500 relative',
          (txBps > 100000 || rxBps > 100000) && glowClass
        )}
      >
        <div
          {...attributes}
          {...listeners}
          className="absolute top-2 right-2 cursor-grab active:cursor-grabbing p-2 hover:bg-secondary rounded-md transition-colors z-10"
          title="Drag untuk mengubah urutan"
        >
          <GripVertical size={18} className="text-muted-foreground" />
        </div>
        <CardHeader>
          <CardTitle className="mb-2">{etherId.toUpperCase()}</CardTitle>
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-red-500"></div>
              <span className="text-muted-foreground">Upload:</span>
              <span className="font-semibold text-red-500">{formatSpeed(txMbps)}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-blue-500"></div>
              <span className="text-muted-foreground">Download:</span>
              <span className="font-semibold text-blue-500">{formatSpeed(rxMbps)}</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="h-80">
          <EtherChart trafficData={currentTraffic} interfaceName={etherId} />
        </CardContent>
      </Card>
    </div>
  );
};

const MainContent = () => {
  const { traffic, activeInterfaces: availableInterfaces, isConnected } = useMikrotik() || { traffic: {}, activeInterfaces: [], isConnected: false };
  const [selectedInterfaces, setSelectedInterfaces] = useState<Set<string>>(new Set());
  const [showFilter, setShowFilter] = useState(false);
  const [interfaceOrder, setInterfaceOrder] = useState<string[]>([]);
  const [hasLoadedSavedSelection, setHasLoadedSavedSelection] = useState(false);
  const [hasUserSelection, setHasUserSelection] = useState(false); // Track if user has ever made a selection

  // Load saved order and selected interfaces from localStorage
  useEffect(() => {
    const savedOrder = localStorage.getItem('dashboard-interface-order');
    if (savedOrder) {
      try {
        setInterfaceOrder(JSON.parse(savedOrder));
      } catch (e) {
        console.error('Failed to load interface order:', e);
      }
    }

    const savedSelection = localStorage.getItem('dashboard-selected-interfaces');
    if (savedSelection !== null) {
      // savedSelection exists (even if empty array), meaning user has made a selection before
      try {
        const parsed = JSON.parse(savedSelection);
        setSelectedInterfaces(new Set(parsed));
        setHasUserSelection(true); // User has made a selection before
      } catch (e) {
        console.error('Failed to load selected interfaces:', e);
      }
    }
    setHasLoadedSavedSelection(true);
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Dapatkan semua interface yang tersedia (dari activeInterfaces atau dari traffic keys)
  // Exclude interface PPPoE - HARUS dipanggil sebelum conditional return
  const allAvailableInterfaces = useMemo(() => {
    const fromTraffic = traffic ? Object.keys(traffic) : [];
    const fromList = availableInterfaces?.map((iface: any) => iface.name) || [];
    const allInterfaces = Array.from(new Set([...fromTraffic, ...fromList]));
    
    // Filter out PPPoE interfaces
    return allInterfaces
      .filter(ifaceName => {
        const ifaceInfo = availableInterfaces?.find((i: any) => i.name === ifaceName);
        const type = (ifaceInfo?.type || '').toLowerCase();
        // Exclude PPPoE interfaces
        return !type.includes('pppoe');
      })
      .sort();
  }, [traffic, availableInterfaces]);

  // Auto-select semua interface yang punya traffic data saat pertama kali (exclude PPPoE)
  // Hanya berjalan jika belum pernah ada user selection dan sudah selesai load dari localStorage
  useEffect(() => {
    if (hasLoadedSavedSelection && !hasUserSelection && traffic && Object.keys(traffic).length > 0 && selectedInterfaces.size === 0) {
      const interfacesWithTraffic = Object.keys(traffic).filter(key => {
        const currentTraffic = traffic[key];
        // Exclude PPPoE interfaces
        const ifaceInfo = availableInterfaces?.find((i: any) => i.name === key);
        const type = (ifaceInfo?.type || '').toLowerCase();
        if (type.includes('pppoe')) return false;
        
        return currentTraffic && (currentTraffic['tx-bits-per-second'] || currentTraffic['rx-bits-per-second']);
      });
      if (interfacesWithTraffic.length > 0) {
        const newSelection = new Set(interfacesWithTraffic);
        setSelectedInterfaces(newSelection);
        setHasUserSelection(true); // Mark that selection has been made
        // Save auto-selected interfaces to localStorage
        try {
          localStorage.setItem('dashboard-selected-interfaces', JSON.stringify(Array.from(newSelection)));
        } catch (e) {
          console.error('Failed to save auto-selected interfaces:', e);
        }
      }
    }
  }, [traffic, selectedInterfaces.size, availableInterfaces, hasLoadedSavedSelection, hasUserSelection]);

  // Tampilkan interface yang dipilih dan punya traffic data
  const displayedInterfaces = useMemo(() => {
    if (!traffic) return [];

    const filtered = Object.keys(traffic)
      .filter(key => {
        const currentTraffic = traffic[key];
        // Tampilkan jika dipilih dan ada data traffic
        return selectedInterfaces.has(key) && 
               currentTraffic && 
               (currentTraffic['tx-bits-per-second'] || currentTraffic['rx-bits-per-second']);
      });

    // Apply saved order if available
    if (interfaceOrder.length > 0) {
      const ordered = interfaceOrder.filter(id => filtered.includes(id));
      const unordered = filtered.filter(id => !interfaceOrder.includes(id));
      return [...ordered, ...unordered];
    }

    return filtered.sort();
  }, [traffic, selectedInterfaces, interfaceOrder]);

  // Update order when displayedInterfaces changes (add new interfaces to end, remove deleted ones)
  const displayedInterfacesString = displayedInterfaces.join(',');
  useEffect(() => {
    if (displayedInterfaces.length === 0) {
      setInterfaceOrder([]);
      localStorage.removeItem('dashboard-interface-order');
      return;
    }

    setInterfaceOrder((prevOrder) => {
      if (prevOrder.length === 0) {
        // Initialize order on first load
        const initialOrder = [...displayedInterfaces];
        localStorage.setItem('dashboard-interface-order', JSON.stringify(initialOrder));
        return initialOrder;
      } else {
        // Update order: keep existing order, add new interfaces at the end, remove deleted ones
        const existingOrder = prevOrder.filter(id => displayedInterfaces.includes(id));
        const newInterfaces = displayedInterfaces.filter(id => !prevOrder.includes(id));
        const updatedOrder = [...existingOrder, ...newInterfaces];
        
        if (updatedOrder.length !== prevOrder.length || 
            updatedOrder.some((id, idx) => id !== prevOrder[idx])) {
          localStorage.setItem('dashboard-interface-order', JSON.stringify(updatedOrder));
          return updatedOrder;
        }
        return prevOrder;
      }
    });
  }, [displayedInterfacesString]); // Trigger when interface list changes

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setInterfaceOrder((items) => {
        const oldIndex = items.indexOf(active.id as string);
        const newIndex = items.indexOf(over.id as string);
        const newOrder = arrayMove(items, oldIndex, newIndex);
        localStorage.setItem('dashboard-interface-order', JSON.stringify(newOrder));
        return newOrder;
      });
    }
  };

  const toggleInterface = (interfaceName: string) => {
    setSelectedInterfaces(prev => {
      const newSet = new Set(prev);
      if (newSet.has(interfaceName)) {
        newSet.delete(interfaceName);
      } else {
        newSet.add(interfaceName);
      }
      setHasUserSelection(true); // Mark that user has made a selection
      // Save to localStorage
      try {
        localStorage.setItem('dashboard-selected-interfaces', JSON.stringify(Array.from(newSet)));
      } catch (e) {
        console.error('Failed to save selected interfaces:', e);
      }
      return newSet;
    });
  };

  // Save selected interfaces to localStorage whenever it changes (except during initial load)
  useEffect(() => {
    if (hasLoadedSavedSelection) {
      try {
        if (selectedInterfaces.size > 0) {
          localStorage.setItem('dashboard-selected-interfaces', JSON.stringify(Array.from(selectedInterfaces)));
        } else {
          // Also save empty selection to prevent auto-select on next load
          localStorage.setItem('dashboard-selected-interfaces', JSON.stringify([]));
        }
      } catch (e) {
        console.error('Failed to save selected interfaces:', e);
      }
    }
  }, [selectedInterfaces, hasLoadedSavedSelection]);

  const itemCount = displayedInterfaces.length;
  const gridLayoutClass = itemCount >= 3 ? 'md:grid-cols-2' : 'md:grid-cols-1';

  if (!isConnected) {
    return (
        <div className="md:col-span-2 flex items-center justify-center bg-secondary rounded-xl p-10 h-full">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground"/>
        </div>
    );
  }

  return (
    <div className="flex-grow space-y-4">
      {/* Filter Interface */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <Filter size={18} />
              Pilih Interface ({selectedInterfaces.size}/{allAvailableInterfaces.length})
            </CardTitle>
            <Button 
              variant="ghost" 
              size="sm"
              onClick={() => setShowFilter(!showFilter)}
            >
              {showFilter ? 'Sembunyikan' : 'Tampilkan'}
            </Button>
          </div>
        </CardHeader>
        {showFilter && (
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {allAvailableInterfaces.length > 0 ? (
                allAvailableInterfaces.map((ifaceName) => {
                  const ifaceInfo = availableInterfaces?.find((i: any) => i.name === ifaceName);
                  const hasTraffic = traffic && traffic[ifaceName];
                  const isSelected = selectedInterfaces.has(ifaceName);

          return (
                    <button
                      key={ifaceName}
                      onClick={() => toggleInterface(ifaceName)}
              className={cn(
                        "px-3 py-1.5 rounded-md text-sm border transition-all",
                        isSelected 
                          ? "bg-primary text-primary-foreground border-primary" 
                          : "bg-secondary text-secondary-foreground border-border hover:bg-secondary/80",
                        !hasTraffic && "opacity-50"
              )}
            >
                      {ifaceName.toUpperCase()}
                      {ifaceInfo?.type && (
                        <span className="ml-1 text-xs opacity-75">({ifaceInfo.type})</span>
                      )}
                    </button>
                  );
                })
              ) : (
                <p className="text-sm text-muted-foreground">Belum ada interface yang terdeteksi.</p>
              )}
            </div>
              </CardContent>
        )}
            </Card>

      {/* Traffic Charts */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={displayedInterfaces}
        >
          <div className={cn("grid grid-cols-1 gap-6", gridLayoutClass)}>
            {displayedInterfaces.length > 0 ? (
              displayedInterfaces.map((etherId, index) => {
                const currentTraffic = traffic[etherId];
                return (
                  <SortableInterfaceCard
                    key={etherId}
                    id={etherId}
                    etherId={etherId}
                    currentTraffic={currentTraffic}
                    index={index}
                    itemCount={itemCount}
                  />
          );
        })
      ) : (
        <div className="md:col-span-2 flex items-center justify-center bg-secondary rounded-xl p-10 h-full">
            <div className="text-center space-y-2">
              <p className="text-muted-foreground">
                {selectedInterfaces.size === 0 
                  ? "Pilih interface yang ingin ditampilkan dari filter di atas." 
                  : "Belum ada data traffic untuk interface yang dipilih."}
              </p>
              {allAvailableInterfaces.length === 0 && (
                <p className="text-xs text-muted-foreground">Pastikan interface aktif dan terhubung ke Mikrotik.</p>
              )}
            </div>
        </div>
      )}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
};
export default MainContent;