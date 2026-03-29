'use client';

import React, { useState } from 'react';
import { useNotification } from '@/components/providers/notification-provider';
import { AlertCircle, CheckCircle2, ServerCrash, Cpu, AlertTriangle, ArrowLeft, RefreshCw, Calendar, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function NotificationsPage() {
  const { notifications, fetchNotifications } = useNotification();
  const router = useRouter();
  const [filter, setFilter] = useState<'all' | 'disconnect' | 'reconnect' | 'system'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchNotifications();
    setTimeout(() => setIsRefreshing(false), 500);
  };

  const getIcon = (type: string) => {
    switch (type) {
        case 'disconnect':
            return <AlertCircle className="w-5 h-5 text-red-500" />;
        case 'reconnect':
            return <CheckCircle2 className="w-5 h-5 text-green-500" />;
        case 'device_offline':
            return <ServerCrash className="w-5 h-5 text-red-600" />;
        case 'device_online':
            return <CheckCircle2 className="w-5 h-5 text-emerald-500" />;
        case 'cpu_alarm':
            return <Cpu className="w-5 h-5 text-yellow-500" />;
        default:
            return <AlertTriangle className="w-5 h-5 text-muted-foreground" />;
    }
  };

  const getBorderColor = (type: string) => {
      if (type.includes('disconnect') || type.includes('offline') || type.includes('alarm')) return 'border-l-red-500';
      if (type.includes('reconnect') || type.includes('online')) return 'border-l-green-500';
      return 'border-l-border';
  };

  const filteredNotifications = notifications.filter(notif => {
      // Type filtering
      if (filter === 'disconnect' && !notif.type.includes('disconnect')) return false;
      if (filter === 'reconnect' && !notif.type.includes('reconnect')) return false;
      if (filter === 'system' && !notif.type.includes('device') && !notif.type.includes('cpu')) return false;

      // Search filtering
      if (searchTerm) {
          const lowerSearch = searchTerm.toLowerCase();
          const matchTitle = notif.title && notif.title.toLowerCase().includes(lowerSearch);
          const matchMsg = notif.message && notif.message.toLowerCase().includes(lowerSearch);
          if (!matchTitle && !matchMsg) return false;
      }

      return true;
  });

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header section */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <button 
            onClick={() => router.back()}
            className="flex items-center text-sm text-muted-foreground hover:text-foreground mb-2 transition-colors"
          >
            <ArrowLeft className="w-4 h-4 mr-1" />
            Kembali
          </button>
          <h2 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            Riwayat Notifikasi
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Merekam seluruh riwayat kejadian, gangguan, dan status perangkat selama 7 hari terakhir.
          </p>
        </div>

        <button 
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-2 px-4 py-2 border rounded-md hover:bg-secondary transition-colors text-sm font-medium disabled:opacity-50 w-full sm:w-auto justify-center"
        >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            {isRefreshing ? 'Memuat...' : 'Muat Ulang'}
        </button>
      </div>

      {/* Filters and Controls */}
      <div className="bg-card border rounded-lg p-4 flex flex-col sm:flex-row gap-4 justify-between items-center shadow-sm">
          <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0 hide-scrollbar">
              <button 
                onClick={() => setFilter('all')}
                className={`px-3 py-1.5 text-sm rounded-full transition-colors whitespace-nowrap ${filter === 'all' ? 'bg-primary text-primary-foreground font-semibold' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'}`}
              >
                  Semua Data
              </button>
              <button 
                onClick={() => setFilter('disconnect')}
                className={`px-3 py-1.5 text-sm rounded-full transition-colors whitespace-nowrap ${filter === 'disconnect' ? 'bg-red-500/20 text-red-600 font-semibold dark:text-red-400' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'}`}
              >
                  Putus Akses
              </button>
              <button 
                onClick={() => setFilter('reconnect')}
                className={`px-3 py-1.5 text-sm rounded-full transition-colors whitespace-nowrap ${filter === 'reconnect' ? 'bg-green-500/20 text-green-600 font-semibold dark:text-green-400' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'}`}
              >
                  Terhubung
              </button>
              <button 
                onClick={() => setFilter('system')}
                className={`px-3 py-1.5 text-sm rounded-full transition-colors whitespace-nowrap ${filter === 'system' ? 'bg-blue-500/20 text-blue-600 font-semibold dark:text-blue-400' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'}`}
              >
                  Sistem/Router
              </button>
          </div>
          <div className="relative w-full sm:w-64">
              <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
              <input
                  type="text"
                  placeholder="Cari notifikasi..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-sm border bg-background rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
          </div>
      </div>

      {/* Notification List */}
      <div className="bg-card border rounded-lg shadow-sm overflow-hidden min-h-[400px]">
        {filteredNotifications.length === 0 ? (
          <div className="h-[400px] flex flex-col items-center justify-center text-muted-foreground p-8">
            <Calendar className="w-12 h-12 mb-4 opacity-20" />
            <p className="text-lg font-medium">Tidak ada riwayat notifikasi</p>
            <p className="text-sm">Riwayat Anda tampak bersih saat ini.</p>
          </div>
        ) : (
          <div className="divide-y">
            {filteredNotifications.map((notif: any) => (
              <div 
                key={notif.id} 
                className={`p-4 hover:bg-secondary/30 transition-colors border-l-4 ${getBorderColor(notif.type)}`}
              >
                  <div className="flex gap-4">
                      <div className="mt-1 flex-shrink-0">
                          {getIcon(notif.type)}
                      </div>
                      <div className="flex-1 min-w-0">
                          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-1 mb-1">
                              <h4 className="font-semibold text-foreground text-base flex flex-col sm:flex-row sm:items-center gap-2">
                                  {notif.title || 'Informasi Riwayat'}
                                  {notif.workspace_name && (
                                    <span className="text-xs font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full w-fit whitespace-nowrap">
                                        {notif.workspace_name}
                                    </span>
                                  )}
                              </h4>
                              <span className="text-xs text-muted-foreground whitespace-nowrap bg-muted px-2 py-0.5 rounded-full inline-flex w-fit">
                                  {new Date(notif.created_at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}
                              </span>
                          </div>
                          <p className="text-sm text-muted-foreground leading-relaxed">
                              {notif.message}
                          </p>
                      </div>
                  </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
