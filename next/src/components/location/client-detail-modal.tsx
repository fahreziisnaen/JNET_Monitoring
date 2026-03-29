'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from '@/components/motion';
import {
  X,
  User,
  MapPin,
  Edit,
  Trash2,
  Loader2,
  Wifi,
  WifiOff,
  Network,
  AlertCircle,
  History,
  Calendar,
  ArrowDown,
  Camera,
  Image as ImageIcon,
  Phone,
  Server,
  Copy
} from 'lucide-react';
import { toast } from 'sonner';
import { Doughnut } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip } from 'chart.js';

ChartJS.register(ArcElement, Tooltip);
import { Button } from '@/components/ui/button';
import { Client } from './client-list';
import { apiFetch } from '@/utils/api';
import { useMikrotik } from '@/components/providers/mikrotik-provider';
import { formatUptime } from '@/utils/format';
import { useEscKey } from '@/hooks/useEscKey';

interface PppoeDetails {
  name: string;
  profile: string;
  'remote-address': string | null;
  disabled: boolean;
  isActive: boolean;
  uptime: string | null;
  lastLoggedOut: string | null;
  comment: string | null;
  error?: string;
}

interface SlaData {
  sla_percentage: string;
  recent_events: Array<{
    start_time: string;
    end_time: string | null;
    duration_seconds: number;
    is_ongoing: boolean;
  }>;
}

interface UsageData {
  daily: number;
  weekly: number;
  monthly: number;
}

interface ClientDetailModalProps {
  isOpen: boolean;
  client: Client | null;
  onClose: () => void;
  onEdit: (_client: Client) => void;
  onDelete: (_client: Client) => void;
  onEditPath?: (_client: Client) => void;
  nocWorkspaceId?: number;
  overrideSecrets?: any[];
}

const formatDate = (dateString: string) => {
  return new Date(dateString).toLocaleString('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });
};

const formatDuration = (totalSeconds: number) => {
  if (totalSeconds < 60) return `${Math.round(totalSeconds)} detik`;
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const parts = [];
  if (days > 0) parts.push(`${days}h`);
  if (hours > 0) parts.push(`${hours}j`);
  if (minutes > 0) parts.push(`${minutes}m`);
  return parts.join(' ') || '<1m';
};

const formatDataSize = (bytes: number | string) => {
  const numBytes = typeof bytes === 'string' ? parseFloat(bytes) : bytes;
  if (!numBytes || numBytes < 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(numBytes) / Math.log(k));
  return `${parseFloat((numBytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
};

const ClientDetailModal = ({
  isOpen,
  client,
  onClose,
  onEdit,
  onDelete,
  onEditPath,
  overrideSecrets,
}: ClientDetailModalProps) => {
  const { pppoeSecrets: mikrotikSecrets } = useMikrotik() || {};
  const pppoeSecrets = overrideSecrets || mikrotikSecrets;

  useEscKey(isOpen, onClose);


  const [slaData, setSlaData] = useState<SlaData | null>(null);
  const [usageData, setUsageData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showFullImage, setShowFullImage] = useState(false);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;

  // Get PPPoE details from WebSocket data
  const pppoeDetails = useMemo(() => {
    if (!pppoeSecrets || !client) return null;

    const secretsArray = Array.isArray(pppoeSecrets) ? pppoeSecrets : [];
    const secret = secretsArray.find((s: any) => s.name === client.pppoe_secret_name);

    if (!secret) return null;

    return {
      name: secret.name || client.pppoe_secret_name,
      profile: secret.profile || 'N/A',
      'remote-address': secret.currentAddress || secret['remote-address'] || null,
      disabled: secret.disabled === 'true' || secret.disabled === true,
      isActive: secret.isActive === true,
      uptime: secret.uptime || null,
      lastLoggedOut: secret['last-logged-out'] || null,
      comment: secret.comment || null,
    };
  }, [pppoeSecrets, client]);

  // Fetch SLA and usage data
  const fetchClientData = React.useCallback(async (isInitial = false) => {
    if (!client) return;

    if (isInitial) {
      setLoading(true);
    } else {
      setIsRefreshing(true);
    }

    try {
      const [slaRes, usageRes] = await Promise.all([
        apiFetch(`${apiUrl}/api/pppoe/secrets/${client.pppoe_secret_name}/sla`).catch(() => null),
        apiFetch(`${apiUrl}/api/pppoe/secrets/${client.pppoe_secret_name}/usage`).catch(() => null)
      ]);

      if (slaRes && slaRes.ok) {
        const sla = await slaRes.json();
        setSlaData({
          sla_percentage: sla.sla_percentage || '0',
          recent_events: sla.recent_events || []
        });
      }

      if (usageRes && usageRes.ok) {
        const usage = await usageRes.json();
        setUsageData(usage);
      }

      setError(null);
    } catch (err: any) {
      console.error('Error fetching client details:', err);
      setError(err.message || 'Gagal memuat data client.');
    } finally {
      if (isInitial) {
        setLoading(false);
      } else {
        setIsRefreshing(false);
      }
    }
  }, [client, apiUrl]);

  useEffect(() => {
    if (client && isOpen) {
      setError(null);
      setDeviceName(null);
      fetchClientData(true);

      // Fetch device name
      const deviceId = (client as any).device_id;
      if (deviceId) {
        apiFetch(`${apiUrl}/api/devices`)
          .then(res => res.ok ? res.json() : [])
          .then((devices: any[]) => {
            const device = devices.find((d: any) => d.id === deviceId);
            setDeviceName(device ? `${device.name} (${device.host})` : `Device #${deviceId}`);
          })
          .catch(() => {});
      }

      const intervalId = setInterval(() => {
        fetchClientData(false);
      }, 5000);

      return () => {
        clearInterval(intervalId);
      };
    } else {
      setSlaData(null);
      setUsageData(null);
      setLoading(true);
    }
  }, [client, isOpen, fetchClientData, apiUrl]);

  // Handle ESC key to close modal or full image
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showFullImage) {
          setShowFullImage(false);
        } else {
          onClose();
        }
      }
    };

    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, showFullImage, onClose]);

  if (!isOpen || !client) return null;

  const lat = parseFloat(client.latitude.toString());
  const lon = parseFloat(client.longitude.toString());
  const pppoe = pppoeDetails;
  const odpName = client.odp_name;

  let waLink = '';
  if (client.whatsapp_number) {
    let num = client.whatsapp_number.replace(/\D/g, ''); // hapus non-digit
    if (num.startsWith('0')) {
      num = '62' + num.substring(1);
    }
    waLink = `https://wa.me/${num}`;
  }

  const handleCopyInfo = async () => {
    try {
      let lastDowntime = '-';
      if (pppoeDetails && pppoeDetails.lastLoggedOut) {
        lastDowntime = pppoeDetails.lastLoggedOut;
      }

      const mapsLink = `https://www.google.com/maps?q=${client.latitude},${client.longitude}`;

      let odpInfo = '-';
      if (client.odp_name) {
        odpInfo = client.odp_name;
      }

      const infoText = `*Nama :* ${client.client_name || '-'}
*PPPoE :* ${client.pppoe_secret_name}
*No WA :* ${client.whatsapp_number || '-'}
*ODP :* ${odpInfo}
*Lokasi :* ${mapsLink}
*Downtime Terakhir :* ${lastDowntime}`;

      await navigator.clipboard.writeText(infoText);
      toast.success("Info Disalin", { description: "Informasi client berhasil disalin ke clipboard." });
    } catch (err) {
      console.error(err);
      toast.error("Gagal Menyalin", { description: "Terjadi kesalahan saat mencoba menyalin info." });
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-[1001] p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 50, opacity: 0 }}
            transition={{ type: 'spring', damping: 20, stiffness: 300 }}
            className="bg-card text-card-foreground rounded-2xl shadow-2xl w-full max-w-lg border max-h-[90vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex justify-between items-center p-4 border-b flex-shrink-0">
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold truncate" title={client.pppoe_secret_name}>
                  {client.pppoe_secret_name}
                </h2>
                {isRefreshing && (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopyInfo}
                  className="p-1 rounded-full hover:bg-secondary text-muted-foreground hover:text-primary transition-colors"
                  title="Copy Info"
                >
                  <Copy size={18} />
                </button>
                <button
                  onClick={onClose}
                  className="p-1 rounded-full hover:bg-secondary"
                >
                  <X size={20} />
                </button>
              </div>
            </header>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {loading ? (
                <div className="flex justify-center items-center py-8">
                  <Loader2 className="animate-spin h-8 w-8 text-muted-foreground" />
                </div>
              ) : error ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <AlertCircle className="h-8 w-8 text-destructive mb-2" />
                  <p className="text-sm text-destructive">{error}</p>
                </div>
              ) : (
                <>
                  {/* Client Image & Basic Info */}
                  <div className="flex flex-col sm:flex-row gap-6 items-start">
                    {client.photo_url ? (
                      <div
                        className="relative w-full sm:w-32 aspect-square rounded-xl overflow-hidden border shadow-sm group cursor-pointer active:scale-95 transition-transform flex-shrink-0"
                        onClick={() => setShowFullImage(true)}
                      >
                        <img
                          src={`${apiUrl}${client.photo_url}`}
                          alt={client.pppoe_secret_name}
                          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                        />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <span className="text-[10px] text-white font-medium bg-black/50 px-2 py-1 rounded-full">Klik Zoom</span>
                        </div>
                      </div>
                    ) : (
                      <div className="w-full sm:w-32 aspect-square rounded-xl bg-secondary flex items-center justify-center text-muted-foreground border border-dashed border-muted-foreground/25 flex-shrink-0">
                        <div className="flex flex-col items-center gap-1">
                          <User size={32} />
                          <span className="text-[10px] uppercase font-bold tracking-tighter opacity-50">No Photo</span>
                        </div>
                      </div>
                    )}

                    <div className="flex-1 space-y-3 w-full">
                      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                        Informasi Client
                      </h3>

                      <div className="flex items-center gap-3">
                        <MapPin size={16} className="text-muted-foreground" />
                        <span className="text-sm">
                          Koordinat:{' '}
                          <a
                            href={`https://www.google.com/maps?q=${lat},${lon}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-xs text-primary hover:underline"
                          >
                            {lat.toFixed(5)}, {lon.toFixed(5)}
                          </a>
                        </span>
                      </div>

                      {odpName && (
                        <div className="flex items-center gap-3">
                          <Network size={16} className="text-muted-foreground" />
                          <span className="text-sm">
                            ODP:{' '}
                            <span className="font-semibold">{odpName}</span>
                          </span>
                        </div>
                      )}

                      {deviceName && (
                        <div className="flex items-center gap-3">
                          <Server size={16} className="text-muted-foreground" />
                          <span className="text-sm">
                            MikroTik:{' '}
                            <span className="font-semibold">{deviceName}</span>
                          </span>
                        </div>
                      )}

                      {client.client_name && (
                        <div className="flex items-center gap-3">
                          <User size={16} className="text-muted-foreground" />
                          <span className="text-sm">
                            Nama Client:{' '}
                            <span className="font-semibold">{client.client_name}</span>
                          </span>
                        </div>
                      )}

                      {client.whatsapp_number && (
                        <div className="flex items-center gap-3">
                          <Phone size={16} className="text-muted-foreground" />
                          <span className="text-sm">
                            WhatsApp:{' '}
                            <a
                              href={waLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-semibold text-primary hover:underline hover:text-green-500 transition-colors"
                            >
                              {client.whatsapp_number}
                            </a>
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* PPPoE Details */}
                  {pppoe && (
                    <div className="pt-4 border-t space-y-3">
                      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                        Informasi PPPoE
                      </h3>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="flex items-center gap-3">
                          <User size={16} className="text-muted-foreground" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-muted-foreground">Profile</p>
                            <p className="text-sm font-semibold truncate">{pppoe.profile}</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          {pppoe.isActive ? (
                            <Wifi size={16} className="text-green-500" />
                          ) : (
                            <WifiOff size={16} className="text-muted-foreground" />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-muted-foreground">Status</p>
                            <p className={`text-sm font-semibold ${pppoe.isActive ? 'text-green-500' : 'text-muted-foreground'}`}>
                              {pppoe.isActive ? 'Aktif' : pppoe.disabled ? 'Nonaktif' : 'Tidak Aktif'}
                            </p>
                          </div>
                        </div>
                      </div>

                      {pppoe['remote-address'] && (
                        <div className="flex items-center gap-3">
                          <Network size={16} className="text-muted-foreground" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-muted-foreground">Remote Address</p>
                            <a
                              href={`http://${pppoe['remote-address']}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm font-mono font-semibold text-primary hover:underline break-all"
                            >
                              {pppoe['remote-address']}
                            </a>
                          </div>
                        </div>
                      )}

                      {pppoe.comment && (
                        <div className="flex items-start gap-3">
                          <AlertCircle size={16} className="text-muted-foreground mt-0.5" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-muted-foreground">Komentar</p>
                            <p className="text-sm">{pppoe.comment}</p>
                          </div>
                        </div>
                      )}

                      {pppoe.uptime && (
                        <div className="flex items-center gap-3">
                          <Network size={16} className="text-muted-foreground" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-muted-foreground">Uptime</p>
                            <p className="text-sm font-semibold">{formatUptime(pppoe.uptime)}</p>
                          </div>
                        </div>
                      )}

                      {!pppoe.isActive && pppoe.lastLoggedOut && (
                        <div className="flex items-center gap-3">
                          <History size={16} className="text-muted-foreground" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-muted-foreground">Terakhir Disconnect</p>
                            <p className="text-sm font-semibold text-muted-foreground">{pppoe.lastLoggedOut}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* SLA & Usage Data */}
                  {slaData && usageData && (
                    <div className="pt-4 border-t">
                      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">
                        Informasi SLA & Usage
                      </h3>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* SLA Chart */}
                        <div className="flex flex-col items-center justify-center space-y-4">
                          <div className="relative h-32 w-32">
                            <Doughnut
                              data={{
                                datasets: [{
                                  data: [
                                    parseFloat(slaData.sla_percentage || '0'),
                                    100 - parseFloat(slaData.sla_percentage || '0')
                                  ],
                                  backgroundColor: [
                                    parseFloat(slaData.sla_percentage || '0') >= 99.9 ? '#22c55e' :
                                      parseFloat(slaData.sla_percentage || '0') >= 99.0 ? '#facc15' : '#ef4444',
                                    '#374151'
                                  ],
                                  borderColor: 'transparent',
                                  hoverOffset: 8,
                                  borderRadius: 5,
                                }]
                              }}
                              options={{
                                responsive: true,
                                maintainAspectRatio: false,
                                cutout: '80%',
                                animation: { animateRotate: true, duration: 1200 },
                                plugins: { tooltip: { enabled: false } }
                              }}
                            />
                            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                              <span className="text-2xl font-bold tracking-tight">
                                {parseFloat(slaData.sla_percentage || '0').toFixed(2)}
                                <span className="text-lg text-muted-foreground">%</span>
                              </span>
                              <span className="text-xs text-muted-foreground mt-1">Uptime</span>
                            </div>
                          </div>

                          {/* Usage Data */}
                          <div className="w-full pt-4 mt-2 border-t text-sm space-y-2">
                            <div className="flex justify-between items-center">
                              <span className="text-muted-foreground flex items-center gap-1.5">
                                <Calendar size={14} /> Hari Ini
                              </span>
                              <span className="font-semibold">{formatDataSize(usageData.daily)}</span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-muted-foreground flex items-center gap-1.5">
                                <Server size={14} /> 7 Hari
                              </span>
                              <span className="font-semibold">{formatDataSize(usageData.weekly)}</span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-muted-foreground flex items-center gap-1.5">
                                <ArrowDown size={14} /> 30 Hari
                              </span>
                              <span className="font-semibold">{formatDataSize(usageData.monthly)}</span>
                            </div>
                          </div>
                        </div>

                        {/* Recent Downtime Events */}
                        <div>
                          <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                            <History size={16} /> Riwayat Downtime Terakhir
                          </h4>
                          <div className="space-y-2 max-h-[200px] overflow-y-auto pr-2 bg-secondary/50 p-3 rounded-lg">
                            {slaData.recent_events && slaData.recent_events.length > 0 ? (
                              slaData.recent_events.map((event, i) => (
                                <div
                                  key={i}
                                  className={`text-sm p-2 bg-background rounded-md flex justify-between items-center ${event.is_ongoing ? 'border-l-4 border-l-red-500' : ''
                                    }`}
                                >
                                  <div>
                                    <p className="font-semibold text-xs text-muted-foreground">
                                      {formatDate(event.start_time)}
                                    </p>
                                    {event.is_ongoing && (
                                      <p className="text-xs text-red-500 font-semibold mt-1">
                                        Sedang berlangsung...
                                      </p>
                                    )}
                                  </div>
                                  <div className="text-right">
                                    <p className={`font-semibold text-sm ${event.is_ongoing ? 'text-red-500' : ''}`}>
                                      {formatDuration(event.duration_seconds)}
                                    </p>
                                  </div>
                                </div>
                              ))
                            ) : (
                              <p className="text-sm text-center text-muted-foreground p-4">
                                Tidak ada catatan downtime. Mantap!
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            <footer className="flex justify-between items-center p-4 bg-secondary/50 rounded-b-2xl flex-shrink-0">
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    onEdit(client);
                    onClose();
                  }}
                  title="Edit Client"
                >
                  <Edit size={16} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    onDelete(client);
                    onClose();
                  }}
                  className="text-muted-foreground hover:text-destructive"
                  title="Hapus Client"
                >
                  <Trash2 size={16} />
                </Button>
              </div>
              <Button variant="outline" onClick={onClose}>
                Tutup
              </Button>
            </footer>
          </motion.div>
        </motion.div>
      )}

      {/* Full Screen Image Modal */}
      <AnimatePresence>
        {showFullImage && client?.photo_url && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/95 z-[2000] flex items-center justify-center p-4 md:p-10"
            onClick={() => setShowFullImage(false)}
          >
            <motion.button
              initial={{ scale: 0, rotate: -90 }}
              animate={{ scale: 1, rotate: 0 }}
              className="absolute top-6 right-6 p-2 bg-white/10 hover:bg-white/20 rounded-full text-white z-50 backdrop-blur-md"
              onClick={() => setShowFullImage(false)}
            >
              <X size={24} />
            </motion.button>
            <motion.div
              layoutId={`client-photo-${client.id}`}
              className="relative max-w-5xl w-full h-full flex items-center justify-center"
            >
              <img
                src={`${apiUrl}${client.photo_url}`}
                alt={client.pppoe_secret_name}
                className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
              />
              <div className="absolute bottom-[-40px] left-0 right-0 text-center">
                <p className="text-white font-medium">{client.pppoe_secret_name}</p>
                <p className="text-white/50 text-xs">Client Photo</p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </AnimatePresence>
  );
};

export default ClientDetailModal;
