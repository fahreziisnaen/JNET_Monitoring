'use client';

import React from 'react';
import { useMikrotik } from '@/components/providers/mikrotik-provider';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Loader2, ChevronDown, ChevronUp, Activity } from 'lucide-react';
import { Doughnut } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip } from 'chart.js';
import { cn } from '@/lib/utils';
import { apiFetch } from '@/utils/api';

ChartJS.register(ArcElement, Tooltip);

const formatBytes = (bytes: number, decimals = 2) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

const formatUptime = (uptimeStr: string) => {
  if (!uptimeStr) return '...';
  const parts = [];
  const weekMatch = uptimeStr.match(/(\d+)w/);
  const dayMatch = uptimeStr.match(/(\d+)d/);
  const hourMatch = uptimeStr.match(/(\d+)h/);
  const minuteMatch = uptimeStr.match(/(\d+)m/);

  if (weekMatch) parts.push(`${weekMatch[1]} week`);
  if (dayMatch) parts.push(`${dayMatch[1]} day`);
  if (hourMatch) parts.push(`${hourMatch[1]} hours`);
  if (minuteMatch) parts.push(`${minuteMatch[1]} minute`);
  
  return parts.join(' ') || 'Baru saja aktif';
};

const DeviceInfoCard = ({ deviceId, data, connected, name }: { deviceId: number, data: any, connected: boolean, name: string }) => {
  const [minimized, setMinimized] = React.useState(false);
  const resource = data?.resource;

  if (!connected || !resource) {
    return (
      <Card className="mb-4">
        <CardHeader className="py-3 flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-red-500" />
            <CardTitle className="text-sm font-bold">{name}</CardTitle>
          </div>
          <span className="text-[10px] text-muted-foreground uppercase">Terputus</span>
        </CardHeader>
      </Card>
    );
  }

  const pppoeSecrets = data?.pppoeSecrets || [];
  const totalSecrets = pppoeSecrets.length;
  const activeSecrets = pppoeSecrets.filter((secret: { isActive: boolean }) => secret.isActive === true).length;
  const inactiveSecrets = totalSecrets - activeSecrets;
  
  const cpuLoad = parseInt(resource['cpu-load'] || '0', 10);
  const totalMemory = parseInt(resource['total-memory'] || '1', 10);
  const freeMemory = parseInt(resource['free-memory'] || '0', 10);
  const usedMemory = totalMemory - freeMemory;
  const ramUsage = totalMemory > 0 ? Math.round((usedMemory / totalMemory) * 100) : 0;
  
  const totalDisk = parseInt(resource['total-hdd-space'] || '1', 10);
  const freeDisk = parseInt(resource['free-hdd-space'] || '0', 10);
  const usedDisk = totalDisk - freeDisk;
  const diskUsage = totalDisk > 0 ? Math.round((usedDisk / totalDisk) * 100) : 0;
  
  const chartOptions: any = { responsive: true, maintainAspectRatio: false, cutout: '75%', plugins: { tooltip: { enabled: false }, legend: { display: false } } };
  const cpuChartData = { datasets: [{ data: [cpuLoad, 100 - cpuLoad], backgroundColor: ['#8b5cf6', '#374151'], borderWidth: 0 }] };
  const ramChartData = { datasets: [{ data: [ramUsage, 100 - ramUsage], backgroundColor: ['#3b82f6', '#374151'], borderWidth: 0 }] };
  const diskChartData = { datasets: [{ data: [diskUsage, 100 - diskUsage], backgroundColor: ['#10b981', '#374151'], borderWidth: 0 }] };

  return (
    <Card className="mb-4 overflow-hidden border-primary/10">
      <CardHeader 
        className={cn(
            "py-3 flex flex-row items-center justify-between cursor-pointer hover:bg-muted/50 transition-colors",
            minimized ? "bg-muted/30" : "bg-muted/50"
        )}
        onClick={() => setMinimized(!minimized)}
      >
        <div className="flex items-center gap-2 overflow-hidden flex-1">
          <div className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
          <CardTitle className="text-sm font-bold truncate">{name}</CardTitle>
        </div>
        <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-primary px-1.5 py-0.5 bg-primary/10 rounded">{activeSecrets} Act</span>
            {minimized ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </div>
      </CardHeader>
      {!minimized && (
        <CardContent className="p-4 space-y-5 animate-in fade-in slide-in-from-top-1 duration-200">
            <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="bg-secondary/50 p-2.5 rounded-lg border border-primary/5">
                    <p className="text-muted-foreground uppercase font-bold text-[9px]">Board Name</p>
                    <p className="truncate font-bold text-foreground">{resource['board-name'] || '...'}</p>
                </div>
                <div className="bg-secondary/50 p-2.5 rounded-lg border border-primary/5">
                    <p className="text-muted-foreground uppercase font-bold text-[9px]">Uptime</p>
                    <p className="truncate font-bold text-foreground">{formatUptime(resource.uptime)}</p>
                </div>
            </div>

            <div className="grid grid-cols-3 gap-2 py-1 text-[10px] font-bold uppercase tracking-tight">
                <div className="bg-blue-500/10 border border-blue-500/20 p-2 rounded-lg text-center">
                    <p className="text-blue-500/70 mb-0.5">Total Secret</p>
                    <p className="text-blue-500 text-sm">{totalSecrets}</p>
                </div>
                <div className="bg-green-500/10 border border-green-500/20 p-2 rounded-lg text-center">
                    <p className="text-green-500/70 mb-0.5">Aktif</p>
                    <p className="text-green-500 text-sm">{activeSecrets}</p>
                </div>
                <div className="bg-red-500/10 border border-red-500/20 p-2 rounded-lg text-center">
                    <p className="text-red-500/70 mb-0.5">Tidak Aktif</p>
                    <p className="text-red-500 text-sm">{inactiveSecrets}</p>
                </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
                <div className="text-center">
                    <p className="text-[10px] font-bold text-muted-foreground mb-2 uppercase tracking-wider">CPU</p>
                    <div className="relative h-16 w-16 mx-auto">
                        <Doughnut data={cpuChartData} options={chartOptions} />
                        <div className="absolute inset-0 flex items-center justify-center font-black text-xs">{cpuLoad}%</div>
                    </div>
                </div>
                <div className="text-center">
                    <p className="text-[10px] font-bold text-muted-foreground mb-2 uppercase tracking-wider">RAM</p>
                    <div className="relative h-16 w-16 mx-auto">
                        <Doughnut data={ramChartData} options={chartOptions} />
                        <div className="absolute inset-0 flex items-center justify-center font-black text-xs">{ramUsage}%</div>
                    </div>
                </div>
                <div className="text-center">
                    <p className="text-[10px] font-bold text-muted-foreground mb-2 uppercase tracking-wider">Disk</p>
                    <div className="relative h-16 w-16 mx-auto">
                        <Doughnut data={diskChartData} options={chartOptions} />
                        <div className="absolute inset-0 flex items-center justify-center font-black text-xs">{diskUsage}%</div>
                    </div>
                </div>
            </div>
            
            <div className="pt-1 border-t border-primary/5">
                <div className="flex justify-between items-center text-[10px] text-muted-foreground">
                    <span>RAM: {formatBytes(usedMemory)} / {formatBytes(totalMemory)}</span>
                    <span className="font-medium text-foreground/70">OS: {resource.version || '...'}</span>
                </div>
            </div>
        </CardContent>
      )}
    </Card>
  );
};

const Sidebar = () => {
  const { allDevicesData, allDevicesStatus, selectedDeviceIds } = useMikrotik() || { allDevicesData: {}, allDevicesStatus: {}, selectedDeviceIds: [] };
  const [deviceNames, setDeviceNames] = React.useState<Record<number, string>>({});

  React.useEffect(() => {
    const fetchDeviceNames = async () => {
        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
            const res = await apiFetch(`${apiUrl}/api/devices`);
            if (res.ok) {
                const data = await res.json();
                const names: Record<number, string> = {};
                data.forEach((d: any) => names[d.id] = d.name);
                setDeviceNames(names);
            }
        } catch (e) {
            console.error('Failed to fetch device names:', e);
        }
    };
    fetchDeviceNames();
  }, []);

  if (selectedDeviceIds.length === 0) {
    return (
        <aside className="w-full lg:w-80 lg:flex-shrink-0">
            <Card className="border-dashed">
                <CardContent className="p-10 flex flex-col items-center justify-center text-center gap-3">
                    <Activity className="h-8 w-8 text-muted-foreground opacity-20" />
                    <p className="text-sm text-muted-foreground">Pilih perangkat untuk melihat statistik resource.</p>
                </CardContent>
            </Card>
        </aside>
    );
  }

  return (
    <aside className="w-full lg:w-80 lg:flex-shrink-0 space-y-4">
      <div className="flex items-center gap-2 mb-2 px-1">
          <Activity size={16} className="text-primary" />
          <h3 className="font-bold text-sm tracking-tight uppercase">Statistik Perangkat</h3>
      </div>
      
      {selectedDeviceIds.map((id: number) => (
        <DeviceInfoCard 
            key={id}
            deviceId={id}
            name={deviceNames[id] || `Device ${id}`}
            data={allDevicesData[id]}
            connected={allDevicesStatus[id]?.isConnected}
        />
      ))}
    </aside>
  );
};

export default Sidebar;