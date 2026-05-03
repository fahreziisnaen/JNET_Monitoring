'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from '@/components/motion';
import { Activity, Clock, Database, Globe, Hash, Info, MapPin, Network, Server, ShieldAlert, Monitor, WifiOff, X, User, Phone } from 'lucide-react';
import { useAuth } from '@/components/providers/auth-provider';
import { formatUptime, parseUptimeToSeconds, formatSecondsToUptime } from '@/utils/format';
import { Line } from 'react-chartjs-2';
import { 
    Chart as ChartJS, 
    CategoryScale, 
    LinearScale, 
    PointElement, 
    LineElement, 
    Title, 
    Tooltip as ChartTooltip, 
    Legend 
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, ChartTooltip, Legend);

interface PppoeSecret {
    id?: string;
    '.id'?: string;
    name: string;
    profile: string;
    service?: string;
    disabled?: 'true' | 'false' | string | boolean;
    isActive?: boolean;
    uptime?: string;
    currentAddress?: string;
    'remote-address'?: string;
    remoteAddress?: string;
    deviceId?: number | string;
    workspaceId?: number | string;
    workspace_id?: number | string;
    client_name?: string;
    whatsapp_number?: string;
}

interface TrafficPoint {
    time: string;
    tx: number;
    rx: number;
}

interface PppoeDetailModalProps {
    isOpen: boolean;
    onClose: () => void;
    secret: PppoeSecret | null;
    deviceId: number;
}

const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 bps';
    const k = 1000;
    const sizes = ['bps', 'kbps', 'Mbps', 'Gbps'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const PppoeDetailModal: React.FC<PppoeDetailModalProps> = ({
    isOpen,
    onClose,
    secret,
    deviceId
}) => {
    const { token } = useAuth();
    const [trafficData, setTrafficData] = useState<TrafficPoint[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [currentUptime, setCurrentUptime] = useState(0);

    // Effect untuk timer Lama Aktif (bertambah setiap detik secara lokal)
    useEffect(() => {
        if (!isOpen || !secret) {
            setCurrentUptime(0);
            return;
        }

        const initialSeconds = parseUptimeToSeconds(secret.uptime);
        setCurrentUptime(initialSeconds);

        if (secret.isActive && initialSeconds > 0) {
            const timer = setInterval(() => {
                setCurrentUptime(prev => prev + 1);
            }, 1000);
            return () => clearInterval(timer);
        }
    }, [isOpen, secret]);

    // Load riwayat awal, lalu polling live traffic tiap 3 detik
    useEffect(() => {
        if (!isOpen || !secret || !deviceId || !token) {
            setTrafficData([]);
            return;
        }

        let isMounted = true;
        let interval: NodeJS.Timeout;

        const getQueryParams = () => {
            const queryParams = new URLSearchParams();
            if (secret?.workspaceId) {
                queryParams.append('workspaceId', secret.workspaceId.toString());
            } else if (secret?.workspace_id) {
                queryParams.append('workspaceId', secret.workspace_id.toString());
            }
            return queryParams.toString() ? `?${queryParams.toString()}` : '';
        };

        const fetchInitialHistory = async () => {
            setIsLoading(true);
            setError(null);
            try {
                const queryString = getQueryParams();
                const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/api/pppoe/${deviceId}/traffic-history/${encodeURIComponent(secret.name)}${queryString}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (!res.ok) throw new Error('Gagal memuat histori traffic');
                
                const data = await res.json();
                if (isMounted) {
                    setTrafficData(data);
                }
            } catch (err: any) {
                if (isMounted) setError(err.message);
            } finally {
                if (isMounted) setIsLoading(false);
            }
        };

        const fetchLiveTraffic = async () => {
            // Jangan fetch jika PPPoE secret sedang offline untuk menghemat koneksi
            if (!secret.isActive) return;

            try {
                const queryString = getQueryParams();
                const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/api/pppoe/${deviceId}/live-traffic/${encodeURIComponent(secret.name)}${queryString}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                
                if (res.ok) {
                    const freshPoint = await res.json();
                    
                    if (isMounted) {
                        setTrafficData(prev => {
                            // Convert Date ke format yang konsisten (time mapping)
                            const pointObj = {
                                tx: freshPoint.tx,
                                rx: freshPoint.rx,
                                time: freshPoint.timestamp
                            };
                            
                            // Pertahankan maksimal 2880 titik untuk menghindari memory leak (histori berhari-hari)
                            const newArr = [...prev, pointObj];
                            if (newArr.length > 2880) return newArr.slice(newArr.length - 2880);
                            return newArr;
                        });
                    }
                }
            } catch (error) {
                // Silent error untuk live polling agar tidak mengganggu UX
                console.warn('Gagal ambil data live:', error);
            }
        };

        fetchInitialHistory().then(() => {
            if (isMounted) {
                // Mulai interogasi 3 detik ke Router jika data riwayat berhasil/gagal ditarik
                interval = setInterval(fetchLiveTraffic, 3000);
            }
        });

        return () => {
            isMounted = false;
            if (interval) clearInterval(interval);
        };
    }, [isOpen, secret, deviceId, token]);

    // Tutup modal dengan tombol Escape
    useEffect(() => {
        if (!isOpen) return;
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, [isOpen, onClose]);

    if (!secret) return null;

    const isDisabled = secret.disabled === 'true' || secret.disabled === true;
    const remoteIp = secret['remote-address'] || secret.remoteAddress || secret.currentAddress || 'IP Dinamis';

    let waLink = '';
    if (secret.whatsapp_number) {
        let num = secret.whatsapp_number.replace(/\D/g, ''); // hapus non-digit
        if (num.startsWith('0')) {
            num = '62' + num.substring(1);
        }
        waLink = `https://wa.me/${num}`;
    }

    // Chart Data Preparation
    const labels = trafficData.map(d => {
        const date = new Date(d.time);
        return date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    });
    // Dari perspektif Router MikroTik:
    // tx = data dikirim router → client = DOWNLOAD client
    // rx = data diterima router ← client = UPLOAD client
    const downloadData = trafficData.map(d => d.tx); // router TX = client Download
    const uploadData = trafficData.map(d => d.rx);   // router RX = client Upload

    const chartData = {
        labels,
        datasets: [
            { 
                label: 'Download', 
                data: downloadData, 
                borderColor: '#10b981', 
                backgroundColor: '#10b98133', 
                tension: 0.2, 
                pointRadius: 0,
                borderWidth: 2
            },
            { 
                label: 'Upload', 
                data: uploadData, 
                borderColor: '#ef4444', 
                backgroundColor: '#ef444433', 
                tension: 0.2, 
                pointRadius: 0,
                borderWidth: 2
            },
        ],
    };

    const chartOptions: any = {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 0 },
        interaction: { mode: 'index', intersect: false },
        scales: {
            y: {
                beginAtZero: true,
                ticks: {
                    callback: (value: number) => formatBytes(value)
                },
                grid: {
                    color: 'rgba(255, 255, 255, 0.1)'
                }
            },
            x: {
                grid: {
                    display: false
                },
                ticks: {
                    maxTicksLimit: Math.min(labels.length, 12),
                    font: { size: 10 }
                }
            }
        },
        plugins: {
            legend: {
                position: 'top',
                labels: { font: { size: 12 } }
            },
            tooltip: {
                backgroundColor: 'rgba(0, 0, 0, 0.8)',
                padding: 12,
                titleFont: { size: 13 },
                callbacks: {
                    label: (context: any) => {
                        const val = context.parsed.y;
                        return `${context.dataset.label}: ${formatBytes(val)}`;
                    }
                }
            }
        }
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div 
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
                        className="bg-card rounded-xl shadow-2xl w-full max-w-2xl border flex flex-col" 
                        onClick={(e) => e.stopPropagation()}
                    >
                        <header className="flex justify-between items-start p-5 border-b pb-4">
                            <div>
                                <h2 className="text-xl font-bold flex items-center gap-2">
                                    <Database className="w-5 h-5 text-primary" />
                                    {secret.name}
                                </h2>
                                <p className="text-sm mt-1 text-muted-foreground">
                                    Informasi Klien PPPoE & Riwayat Trafik Kecepatan (24 Jam)
                                </p>
                            </div>
                            <div className="flex gap-3 items-center">
                                <div className={`px-2.5 py-1 rounded-full text-xs font-semibold uppercase flex items-center gap-1.5 whitespace-nowrap ${
                                    isDisabled ? 'bg-red-500/20 text-red-600 dark:text-red-400'
                                    : secret.isActive ? 'bg-green-500/20 text-green-600 dark:text-green-400'
                                    : 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400'
                                }`}>
                                    {isDisabled ? (
                                        <><ShieldAlert className="w-3.5 h-3.5" /> Terisolir</>
                                    ) : secret.isActive ? (
                                        <><Activity className="w-3.5 h-3.5" /> Online</>
                                    ) : (
                                        <><WifiOff className="w-3.5 h-3.5" /> Offline</>
                                    )}
                                </div>
                                <button type="button" onClick={onClose} className="p-1 rounded-full hover:bg-secondary">
                                    <X size={20} />
                                </button>
                            </div>
                        </header>

                        <div className="p-5 space-y-5 overflow-y-auto max-h-[80vh]">
                            {/* INFO CARDS */}
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                <div className="bg-background/50 border rounded-lg p-3 flex flex-col gap-1">
                                    <span className="text-xs text-muted-foreground flex items-center gap-1 border-b pb-1 border-border/50">
                                        <User className="w-3 h-3"/> Nama Klien
                                    </span>
                                    <span className="text-sm font-semibold truncate">{secret.client_name || '-'}</span>
                                </div>
                                <div className="bg-background/50 border rounded-lg p-3 flex flex-col gap-1">
                                    <span className="text-xs text-muted-foreground flex items-center gap-1 border-b pb-1 border-border/50">
                                        <Phone className="w-3 h-3"/> No WhatsApp
                                    </span>
                                    {secret.whatsapp_number ? (
                                        <a 
                                            href={waLink} 
                                            target="_blank" 
                                            rel="noopener noreferrer"
                                            className="text-sm font-semibold truncate text-primary hover:underline hover:text-green-500 transition-colors"
                                        >
                                            {secret.whatsapp_number}
                                        </a>
                                    ) : (
                                        <span className="text-sm font-semibold truncate">-</span>
                                    )}
                                </div>
                                <div className="bg-background/50 border rounded-lg p-3 flex flex-col gap-1">
                                    <span className="text-xs text-muted-foreground flex items-center gap-1 border-b pb-1 border-border/50">
                                        <Monitor className="w-3 h-3"/> Profil
                                    </span>
                                    <span className="text-sm font-semibold truncate">{secret.profile}</span>
                                </div>
                                <div className="bg-background/50 border rounded-lg p-3 flex flex-col gap-1">
                                    <span className="text-xs text-muted-foreground flex items-center gap-1 border-b pb-1 border-border/50">
                                        <Globe className="w-3 h-3"/> IP Klien
                                    </span>
                                    <span className="text-sm font-mono truncate">{remoteIp}</span>
                                </div>
                                <div className="bg-background/50 border rounded-lg p-3 flex flex-col gap-1">
                                    <span className="text-xs text-muted-foreground flex items-center gap-1 border-b pb-1 border-border/50">
                                        <Clock className="w-3 h-3"/> Lama Aktif
                                    </span>
                                    <span className="text-sm font-semibold truncate">
                                        {secret.isActive ? (currentUptime > 0 ? formatSecondsToUptime(currentUptime) : 'N/A') : 'Terputus'}
                                    </span>
                                </div>
                                <div className="bg-background/50 border rounded-lg p-3 flex flex-col gap-1">
                                    <span className="text-xs text-muted-foreground flex items-center gap-1 border-b pb-1 border-border/50">
                                        <Hash className="w-3 h-3"/> Layanan
                                    </span>
                                    <span className="text-sm font-semibold truncate uppercase">{secret.service || 'PPPoE'}</span>
                                </div>
                            </div>

                            {/* TRAFFIC DASHBOARD */}
                            <div className="bg-background/30 border rounded-lg shadow-sm overflow-hidden flex flex-col">
                                <div className="border-b bg-secondary/30 p-3 flex justify-between items-center">
                                    <h3 className="text-sm font-semibold flex items-center gap-2">
                                        <Network className="w-4 h-4 text-primary" />
                                        Riwayat Trafik Kecepatan
                                    </h3>
                                    {isLoading && (
                                        <span className="text-xs font-medium text-muted-foreground animate-pulse">Memuat data...</span>
                                    )}
                                </div>

                                <div className="p-4 h-[250px] w-full relative bg-card">
                                    {error ? (
                                        <div className="absolute inset-0 flex items-center justify-center text-red-500 text-sm">
                                            {error}
                                        </div>
                                    ) : trafficData.length === 0 && !isLoading ? (
                                        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm flex-col gap-2">
                                            <Info className="w-6 h-6 opacity-50"/>
                                            Belum ada data trafik dalam 24 jam terakhir.
                                        </div>
                                    ) : (
                                        <Line data={chartData} options={chartOptions} />
                                    )}
                                </div>
                            </div>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default PppoeDetailModal;
