'use client';

import React, { useMemo } from 'react';
import { motion } from '@/components/motion';
import { Wifi, ArrowDown, ArrowUp } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { useMikrotik } from '@/components/providers/mikrotik-provider';

const formatSpeed = (bits: string | number = 0) => {
  const numBits = typeof bits === 'string' ? parseFloat(bits) : bits;
  if (numBits === 0) return '0 Kbps';
  const k = 1000;
  const sizes = ['bps', 'Kbps', 'Mbps', 'Gbps'];
  const i = Math.floor(Math.log(numBits) / Math.log(k));
  const value = (numBits / Math.pow(k, i)).toFixed(1);
  return `${value} ${sizes[i]}`;
};

const formatDataSize = (bytes: string | number = 0) => {
  const numBytes = typeof bytes === 'string' ? parseFloat(bytes) : bytes;
  if (numBytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(numBytes) / Math.log(k));
  const value = (numBytes / Math.pow(k, i)).toFixed(2);
  return `${value} ${sizes[i]}`;
};

const formatUptime = (uptimeStr: string = '') => {
  if (!uptimeStr) return '...';
  return uptimeStr;
};

const HotspotActiveList = () => {
  const { hotspotActive, isConnected } = useMikrotik() || { hotspotActive: [], isConnected: false };

  const activeUsers = useMemo(() => {
    if (!hotspotActive) return [];
    
    return hotspotActive.map((user: any) => ({
        id: user['.id'],
        user: user.user,
        address: user.address,
        uptime: user.uptime,
        bytesIn: user['bytes-in'],
        bytesOut: user['bytes-out'],
    }));
  }, [hotspotActive]);

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2 text-emerald-500"><Wifi /> Pengguna Aktif ({isConnected ? activeUsers.length : '...'})</CardTitle></CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left bg-secondary">
              <tr>
                <th className="p-4 font-semibold">User</th>
                <th className="p-4 font-semibold">Address</th>
                <th className="p-4 font-semibold">Uptime</th>
                <th className="p-4 font-semibold">Pemakaian (Down/Up)</th>
              </tr>
            </thead>
            <tbody>
              {activeUsers.length > 0 ? activeUsers.map((user: any, i: number) => (
                <motion.tr key={user.id} className="border-b" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.05 }}>
                  <td className="p-4 font-medium">{user.user}</td>
                  <td className="p-4 font-mono">{user.address}</td>
                  <td className="p-4">{formatUptime(user.uptime)}</td>
                  <td className="p-4 font-mono">{formatDataSize(user.bytesIn)} / {formatDataSize(user.bytesOut)}</td>
                </motion.tr>
              )) : (
                <tr><td colSpan={4} className="text-center p-6 text-muted-foreground">Tidak ada pengguna yang aktif.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
};

export default HotspotActiveList;