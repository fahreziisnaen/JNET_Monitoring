'use client';

import React, { useEffect, useState, useMemo, useRef } from 'react';
import { Line } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend } from 'chart.js';
import { useMikrotik } from '@/components/providers/mikrotik-provider';
import { useAuth } from '@/components/providers/auth-provider';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Loader2, Filter, GripVertical, ChevronDown, ChevronUp, Cpu, HardDrive, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/utils/api';
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

const formatTimeLabel = (date: Date) =>
  date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

const formatTimeLabelWithSeconds = (date: Date) =>
  date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

const formatDateLabel = (date: Date) =>
  date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });

const ChartDateRange = ({ historyHours }: { historyHours: number }) => {
  const now = new Date();
  const start = new Date(Date.now() - historyHours * 3600000);
  const sameDay = formatDateLabel(start) === formatDateLabel(now);
  return (
    <span className="text-[10px] text-muted-foreground tabular-nums">
      {sameDay
        ? `${formatDateLabel(now)}, ${formatTimeLabel(start)} – ${formatTimeLabel(now)}`
        : `${formatDateLabel(start)}, ${formatTimeLabel(start)} – ${formatDateLabel(now)}, ${formatTimeLabel(now)}`
      }
    </span>
  );
};

const EtherChart = ({ trafficData, interfaceName, deviceId, workspaceId, historyHours = 3 }: { trafficData: any; interfaceName: string; deviceId: number | null; workspaceId?: number; historyHours?: number }) => {
  const { user } = useAuth();
  const userWorkspaceId = user?.workspace_id || 'default';
  // Use a more unique key including deviceId
  const storageKey = `chart-data-${userWorkspaceId}-${deviceId}-${interfaceName}`;
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
  const isFirstHistoryHoursRender = useRef(true);

  // Initialize chart data from API or localStorage on mount
  const fetchAndSetHistory = async (hours: number) => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
      const res = await apiFetch(`${apiUrl}/api/devices/${deviceId}/traffic-history?interface=${interfaceName}&hours=${hours}${workspaceId ? `&workspaceId=${workspaceId}` : ''}`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.length > 0) {
          const historyLabels = data.map((r: any) => formatTimeLabelWithSeconds(new Date(r.timestamp)));
          const historyTx = data.map((r: any) => parseFloat((r.tx_bps / 1000000).toFixed(2)));
          const historyRx = data.map((r: any) => parseFloat((r.rx_bps / 1000000).toFixed(2)));
          const maxLength = hours * 60;
          const sliceLabels = historyLabels.slice(-maxLength);
          const sliceTx = historyTx.slice(-maxLength);
          const sliceRx = historyRx.slice(-maxLength);
          while (sliceLabels.length < 30) {
            sliceLabels.unshift('');
            sliceTx.unshift(0);
            sliceRx.unshift(0);
          }
          setChartData({
            labels: sliceLabels,
            datasets: [
              { label: 'Upload (Mbps)', data: sliceTx, borderColor: '#ef4444', backgroundColor: '#ef444433', tension: 0.4, pointRadius: 0 },
              { label: 'Download (Mbps)', data: sliceRx, borderColor: '#3b82f6', backgroundColor: '#3b82f633', tension: 0.4, pointRadius: 0 },
            ]
          });
          lastUpdateRef.current = Date.now();
          return;
        }
      }
    } catch (error) {
      console.warn('Gagal memuat history traffic:', error);
    }
    // Fallback to localStorage
    const saved = loadSavedData();
    if (saved) {
      setChartData(saved);
      try {
        const savedItem = localStorage.getItem(storageKey);
        if (savedItem) {
          const parsed = JSON.parse(savedItem);
          lastUpdateRef.current = parsed.lastUpdate || Date.now();
        }
      } catch (e) { /* ignore */ }
    }
  };

  // On mount: fetch history
  useEffect(() => {
    if (!deviceId) return;
    isInitializedRef.current = true;
    fetchAndSetHistory(historyHours);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId, interfaceName, storageKey]);

  // When historyHours changes (user clicks 1h/3h/6h/24h): re-fetch
  useEffect(() => {
    if (isFirstHistoryHoursRender.current) {
      isFirstHistoryHoursRender.current = false;
      return;
    }
    if (!deviceId || !isInitializedRef.current) return;
    fetchAndSetHistory(historyHours);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyHours]);

  useEffect(() => {
    if (!trafficData || !isInitializedRef.current) return;

    const now = Date.now();

    if (lastUpdateRef.current && now - lastUpdateRef.current < 1500) return;

    const txBps = parseFloat(trafficData['tx-bits-per-second'] || '0');
    const rxBps = parseFloat(trafficData['rx-bits-per-second'] || '0');
    const txMbps = parseFloat((txBps / 1000000).toFixed(2));
    const rxMbps = parseFloat((rxBps / 1000000).toFixed(2));

    lastUpdateRef.current = now;

    setChartData((prevData: typeof initialData) => {
      const newData = {
        labels: [...prevData.labels.slice(1), formatTimeLabelWithSeconds(new Date())],
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
  }, [trafficData, storageKey]);

  const chartOptions: any = { 
    responsive: true, 
    maintainAspectRatio: false, 
    animation: { duration: 400 }, 
    interaction: {
        mode: 'index' as const,
        intersect: false,
    },
    scales: {
        y: {
            beginAtZero: true,
            ticks: { callback: (value: number) => `${value} Mbps` }
        },
        x: {
            ticks: {
                maxTicksLimit: 6,
                maxRotation: 0,
                callback: function(val: any) {
                    const label = (this as any).getLabelForValue(val) || '';
                    // Strip detik: "02:30:45 PM" → "02:30 PM"
                    return label.replace(/:\d{2}(\s*(AM|PM))$/i, '$1');
                }
            }
        }
    },
    plugins: { 
        legend: { position: 'top' as const },
        tooltip: {
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            padding: 12,
            titleFont: { size: 13, weight: 'bold' },
            bodyFont: { size: 13 },
            callbacks: {
                title: (items: any[]) => {
                    // Label sudah dalam format HH:MM AM/PM, tampilkan apa adanya
                    return items[0]?.label || '';
                },
                label: (context: any) => {
                    let label = context.dataset.label || '';
                    if (label) label = label.split(' (')[0] + ': ';
                    if (context.parsed.y !== null) {
                        const val = context.parsed.y;
                        if (val >= 1000) {
                            label += `${(val / 1000).toFixed(2)} Gbps`;
                        } else {
                            label += `${val.toFixed(2)} Mbps`;
                        }
                    }
                    return label;
                }
            }
        }
    } 
  };

  return <Line data={chartData} options={chartOptions} />;
};

// Sortable Item Component untuk Interface Card
interface SortableInterfaceCardProps {
  id: string;
  etherId: string;
  currentTraffic: any;
  index: number;
  itemCount: number;
  deviceId: number | null;
  workspaceId?: number;
}

const SortableInterfaceCard = ({ id, etherId, currentTraffic, index, itemCount, deviceId, workspaceId }: SortableInterfaceCardProps) => {
  const [historyHours, setHistoryHours] = useState(3);
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
      className="transition-all duration-500"
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
          <div className="flex justify-between items-start mb-2 pr-8">
            <CardTitle>{etherId.toUpperCase()}</CardTitle>
            <div className="flex flex-col items-end gap-1">
              <div className="flex bg-secondary/50 p-0.5 rounded-lg border border-border">
                {[1, 3, 6, 24].map((h) => (
                    <button
                        key={h}
                        onClick={() => setHistoryHours(h)}
                        className={cn(
                            "px-2 py-0.5 text-[10px] uppercase font-bold rounded transition-all",
                            historyHours === h
                                ? "bg-primary text-primary-foreground shadow-sm"
                                : "text-muted-foreground hover:text-foreground"
                        )}
                    >
                        {h}Jam
                    </button>
                ))}
              </div>
              <ChartDateRange historyHours={historyHours} />
            </div>
          </div>
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
          <EtherChart trafficData={currentTraffic} interfaceName={etherId} deviceId={deviceId} workspaceId={workspaceId} historyHours={historyHours} />
        </CardContent>
      </Card>
    </div>
  );
};

const MainContent = () => {
  const { user } = useAuth();
  const { allDevicesData, allDevicesStatus, selectedDeviceIds, isLoaded: devicesLoaded } = useMikrotik() || { allDevicesData: {}, allDevicesStatus: {}, selectedDeviceIds: [], isLoaded: false };
  const [selectedInterfaces, setSelectedInterfaces] = useState<Set<string>>(new Set()); // format: "deviceId:interfaceName"
  const [showFilter, setShowFilter] = useState(false);
  const [minimizedDevices, setMinimizedDevices] = useState<Set<number>>(new Set());
  const [interfaceOrder, setInterfaceOrder] = useState<string[]>([]);
  const [hasLoadedSavedSelection, setHasLoadedSavedSelection] = useState(false);
  const [hasUserSelection, setHasUserSelection] = useState(false); // Track if user has ever made a selection

  // Load saved order and selected interfaces from localStorage
  useEffect(() => {
    const orderKey = user?.workspace_id ? `dashboard-interface-order-v2-${user.workspace_id}` : 'dashboard-interface-order';
    const savedOrder = localStorage.getItem(orderKey);
    if (savedOrder) {
      try {
        setInterfaceOrder(JSON.parse(savedOrder));
      } catch (e) {
        console.error('Failed to load interface order:', e);
      }
    }

    const selectionKey = user?.workspace_id ? `selected-interfaces-v2-${user.workspace_id}` : 'dashboard-selected-interfaces';
    const savedSelection = localStorage.getItem(selectionKey);
    if (savedSelection !== null) {
      try {
        const parsed = JSON.parse(savedSelection);
        setSelectedInterfaces(new Set(parsed));
        setHasUserSelection(true);
      } catch (e) {
        console.error('Failed to load selected interfaces:', e);
      }
    }
    setHasLoadedSavedSelection(true);
  }, [user?.workspace_id]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Get all available devices info (names)
  const [deviceMetas, setDeviceMetas] = useState<Record<number, {name: string, workspace_id: number}>>({});
  useEffect(() => {
    const fetchDeviceNames = async () => {
        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
            const res = await apiFetch(`${apiUrl}/api/devices`);
            if (res.ok) {
                const data = await res.json();
                const metas: Record<number, {name: string, workspace_id: number}> = {};
                data.forEach((d: any) => metas[d.id] = { name: d.name, workspace_id: d.workspace_id });
                setDeviceMetas(metas);
            }
        } catch (e) {
            console.error('Failed to fetch device metas:', e);
        }
    };
    fetchDeviceNames();
  }, []);

  // Aggregated interfaces across all selected devices
  const groupedAvailableInterfaces = useMemo(() => {
    const groups: Record<number, string[]> = {};
    
    selectedDeviceIds.forEach((deviceId: number) => {
        const deviceData = allDevicesData[deviceId];
        if (!deviceData) return;

        const fromTraffic = deviceData.traffic ? Object.keys(deviceData.traffic) : [];
        const fromList = deviceData.activeInterfaces?.map((iface: any) => iface.name) || [];
        const allInterfaces = Array.from(new Set([...fromTraffic, ...fromList]));

        groups[deviceId] = allInterfaces
            .filter(ifaceName => {
                const ifaceInfo = deviceData.activeInterfaces?.find((i: { name: string, type: string }) => i.name === ifaceName);
                const type = (ifaceInfo?.type || '').toLowerCase();
                return !type.includes('pppoe');
            })
            .sort();
    });

    return groups;
  }, [allDevicesData, selectedDeviceIds]);

  const allAvailableInterfacesList = useMemo(() => {
    const list: string[] = [];
    Object.entries(groupedAvailableInterfaces).forEach(([deviceId, interfaces]) => {
        interfaces.forEach(iface => list.push(`${deviceId}:${iface}`));
    });
    return list;
  }, [groupedAvailableInterfaces]);

  // DISABLED: auto-select logic

  // Tampilkan interface yang dipilih dan punya traffic data
  // Cleanup selectedInterfaces when devices are unchecked
  useEffect(() => {
    if (!hasLoadedSavedSelection || !devicesLoaded) return;
    
    setSelectedInterfaces(prev => {
        const next = new Set(prev);
        let changed = false;
        
        prev.forEach(key => {
            const deviceId = parseInt(key.split(':')[0]);
            if (!selectedDeviceIds.includes(deviceId)) {
                next.delete(key);
                changed = true;
            }
        });
        
        if (changed) {
            if (user?.workspace_id) {
                const selectionKey = `selected-interfaces-v2-${user.workspace_id}`;
                localStorage.setItem(selectionKey, JSON.stringify(Array.from(next)));
            }
            return next;
        }
        return prev;
    });
  }, [selectedDeviceIds, hasLoadedSavedSelection, devicesLoaded, user?.workspace_id]);

  const displayedInterfaces = useMemo(() => {
    const filtered: string[] = [];

    selectedInterfaces.forEach(key => {
        const [deviceIdStr, ifaceName] = key.split(':');
        const deviceId = parseInt(deviceIdStr);
        
        // Skip if device is not selected
        if (!selectedDeviceIds.includes(deviceId)) return;

        const deviceData = allDevicesData[deviceId];
        
        if (deviceData && deviceData.traffic && deviceData.traffic[ifaceName] !== undefined) {
            filtered.push(key);
        }
    });

    // Apply saved order if available
    if (interfaceOrder.length > 0) {
      const ordered = interfaceOrder.filter(id => filtered.includes(id));
      const unordered = filtered.filter(id => !interfaceOrder.includes(id));
      return [...ordered, ...unordered];
    }

    return filtered.sort();
  }, [allDevicesData, selectedInterfaces, interfaceOrder, selectedDeviceIds]);

  // Update order when displayedInterfaces changes (add new interfaces to end)
  const displayedInterfacesString = displayedInterfaces.join(',');
  useEffect(() => {
    // Only proceed if we've loaded the saved selection and have actual interfaces to show
    if (!hasLoadedSavedSelection || displayedInterfaces.length === 0) {
      return;
    }

    setInterfaceOrder((prevOrder) => {
      if (prevOrder.length === 0) {
        // Initialize order on first load
        const initialOrder = [...displayedInterfaces];
        const orderKey = user?.workspace_id ? `dashboard-interface-order-v2-${user.workspace_id}` : 'dashboard-interface-order';
        localStorage.setItem(orderKey, JSON.stringify(initialOrder));
        return initialOrder;
      } else {
        // Update order: keep ALL existing order (even if not currently in displayedInterfaces),
        // but add new interfaces at the end.
        // We don't remove existing ones automatically to prevent wiping out the order
        // during temporary loading states or if user temporarily deselects them.
        const newInterfaces = displayedInterfaces.filter(id => !prevOrder.includes(id));

        if (newInterfaces.length === 0) {
          // If no new interfaces, check if we need to filter out things that are no longer checked
          // actually we want to keep them in the order so they remember their place if re-checked.
          return prevOrder;
        }

        const updatedOrder = [...prevOrder, ...newInterfaces];
        const orderKey = user?.workspace_id ? `dashboard-interface-order-v2-${user.workspace_id}` : 'dashboard-interface-order';
        localStorage.setItem(orderKey, JSON.stringify(updatedOrder));
        return updatedOrder;
      }
    });
  }, [displayedInterfacesString, hasLoadedSavedSelection]); // Trigger when interface list changes or selection loaded

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setInterfaceOrder((items) => {
        const oldIndex = items.indexOf(active.id as string);
        const newIndex = items.indexOf(over.id as string);
        const newOrder = arrayMove(items, oldIndex, newIndex);
        const orderKey = user?.workspace_id ? `dashboard-interface-order-v2-${user.workspace_id}` : 'dashboard-interface-order';
        localStorage.setItem(orderKey, JSON.stringify(newOrder));
        return newOrder;
      });
    }
  };

  const toggleInterface = (key: string) => {
    setSelectedInterfaces(prev => {
      const newSet = new Set(prev);
      if (newSet.has(key)) {
        newSet.delete(key);
      } else {
        newSet.add(key);
      }
      setHasUserSelection(true);
      return newSet;
    });
  };

  const selectAll = () => {
    setSelectedInterfaces(new Set(allAvailableInterfacesList));
    setHasUserSelection(true);
  };

  const deselectAll = () => {
    setSelectedInterfaces(new Set());
    setHasUserSelection(true);
  };

  const toggleMinimize = (deviceId: number) => {
    setMinimizedDevices(prev => {
        const next = new Set(prev);
        if (next.has(deviceId)) next.delete(deviceId);
        else next.add(deviceId);
        return next;
    });
  };

  // Save selected interfaces to localStorage whenever it changes (except during initial load)
  useEffect(() => {
    if (hasLoadedSavedSelection) {
      try {
        const selectionKey = user?.workspace_id ? `selected-interfaces-v2-${user.workspace_id}` : 'dashboard-selected-interfaces';
        if (selectedInterfaces.size > 0) {
          localStorage.setItem(selectionKey, JSON.stringify(Array.from(selectedInterfaces)));
        } else {
          // Also save empty selection to prevent auto-select on next load
          localStorage.setItem(selectionKey, JSON.stringify([]));
        }
      } catch (e) {
        console.error('Failed to save selected interfaces:', e);
      }
    }
  }, [selectedInterfaces, hasLoadedSavedSelection]);

  const itemCount = displayedInterfaces.length;
  const gridLayoutClass = itemCount >= 3 ? 'md:grid-cols-2' : 'md:grid-cols-1';

  const isConnected = selectedDeviceIds.length > 0 && selectedDeviceIds.some((id: number) => allDevicesStatus[id]?.isConnected);

  return (
    <div className="flex-grow space-y-4">
      {/* Filter Interface */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <Filter size={18} />
              Pilih Interface ({selectedInterfaces.size}/{allAvailableInterfacesList.length})
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
          <CardContent className="space-y-4">
            <div className="flex gap-2 pb-2 border-b">
              <Button variant="outline" size="sm" onClick={selectAll} className="text-xs h-8 px-3">Pilih Semua</Button>
              <Button variant="outline" size="sm" onClick={deselectAll} className="text-xs h-8 px-3">Hapus Semua</Button>
            </div>
            
            <div className="space-y-4 pt-2">
              {selectedDeviceIds.length > 0 ? (
                selectedDeviceIds.map((deviceId: number) => {
                    const interfaces = groupedAvailableInterfaces[deviceId] || [];
                    const isMinimized = minimizedDevices.has(deviceId);
                    const deviceName = deviceMetas[deviceId]?.name || `Device ${deviceId}`;
                    const connected = allDevicesStatus[deviceId]?.isConnected;

                    return (
                        <div key={deviceId} className="border rounded-lg overflow-hidden">
                            <div 
                                onClick={() => toggleMinimize(deviceId)}
                                className={cn(
                                    "flex items-center justify-between px-3 py-2 cursor-pointer transition-colors",
                                    isMinimized ? "bg-muted/30" : "bg-muted/50"
                                )}
                            >
                                <div className="flex items-center gap-2">
                                    <div className={cn("w-2 h-2 rounded-full", connected ? "bg-green-500" : "bg-red-500")} />
                                    <span className="font-bold text-sm">{deviceName}</span>
                                    <span className="text-[10px] text-muted-foreground uppercase">{interfaces.length} Interface</span>
                                </div>
                                {isMinimized ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                            </div>
                            {!isMinimized && (
                                <div className="p-3 flex flex-wrap gap-2 animate-in fade-in slide-in-from-top-1 duration-200">
                                    {interfaces.map(ifaceName => {
                                        const key = `${deviceId}:${ifaceName}`;
                                        const isSelected = selectedInterfaces.has(key);
                                        const deviceData = allDevicesData[deviceId];
                                        const hasTraffic = deviceData?.traffic && deviceData.traffic[ifaceName];
                                        const ifaceInfo = deviceData?.activeInterfaces?.find((i: { name: string, type: string }) => i.name === ifaceName);

                                        return (
                                            <button
                                                key={key}
                                                onClick={() => toggleInterface(key)}
                                                className={cn(
                                                    "px-3 py-1.5 rounded-md text-xs border transition-all flex items-center gap-1",
                                                    isSelected
                                                        ? "bg-primary text-primary-foreground border-primary"
                                                        : "bg-secondary text-secondary-foreground border-border hover:bg-secondary/80",
                                                    !hasTraffic && "opacity-50"
                                                )}
                                            >
                                                {ifaceName.toUpperCase()}
                                                {ifaceInfo?.type && (
                                                    <span className="opacity-75 text-[10px]">({ifaceInfo.type})</span>
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    );
                })
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4 italic">Pilih perangkat terlebih dahulu.</p>
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
          <div className={cn("grid grid-cols-1 gap-6 traffic-grid", gridLayoutClass)}>
            {displayedInterfaces.length > 0 ? (
              displayedInterfaces.map((key, index) => {
                const [deviceIdStr, ifaceName] = key.split(':');
                const deviceId = parseInt(deviceIdStr);
                const deviceData = allDevicesData[deviceId];
                const currentTraffic = deviceData?.traffic ? deviceData.traffic[ifaceName] : null;
                const deviceMeta = deviceMetas[deviceId];
                const deviceName = deviceMeta?.name || `Device ${deviceId}`;
                const workspaceIdForDevice = deviceMeta?.workspace_id;
                
                return (
                  <div key={key} className="relative group">
                    <div className="absolute -top-3 left-4 px-2 py-0.5 bg-primary text-[10px] font-bold text-primary-foreground rounded-full z-10 shadow-sm opacity-80 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                        <Activity size={10} />
                        {deviceName}
                    </div>
                    <SortableInterfaceCard
                        id={key}
                        etherId={ifaceName}
                        currentTraffic={currentTraffic}
                        index={index}
                        itemCount={itemCount}
                        deviceId={deviceId}
                        workspaceId={workspaceIdForDevice}
                    />
                  </div>
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
                  {allAvailableInterfacesList.length === 0 && (
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