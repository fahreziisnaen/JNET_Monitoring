'use client';

import React from 'react';
import { motion } from '@/components/motion';
import { useMikrotik } from '@/components/providers/mikrotik-provider';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import { formatUptime } from '@/utils/format';

const PppoeTable = () => {
    const { pppoeSecrets, isConnected } = useMikrotik() || { pppoeSecrets: [], isConnected: false };
    
    // Filter hanya yang aktif
    const activeUsers = pppoeSecrets.filter((secret: any) => secret.isActive === true);

    return (
        <Card>
            <CardHeader>
                <CardTitle>PPPoE Active Users ({isConnected && activeUsers ? activeUsers.length : '...'})</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="text-left bg-secondary">
                            <tr>
                                <th className="p-4 font-semibold">Nama</th>
                                <th className="p-4 font-semibold">Service</th>
                                <th className="p-4 font-semibold">Uptime</th>
                                <th className="p-4 font-semibold">Address</th>
                            </tr>
                        </thead>
                        <tbody>
                            {!isConnected ? (
                                <tr>
                                    <td colSpan={4} className="text-center p-10 text-muted-foreground">
                                        <div className="flex justify-center items-center gap-2">
                                            <Loader2 className="animate-spin h-5 w-5" />
                                            <span>Menyambungkan...</span>
                                        </div>
                                    </td>
                                </tr>
                            ) : activeUsers && activeUsers.length > 0 ? (
                                activeUsers.map((user: any, i: number) => (
                                    <motion.tr
                                        key={user['.id'] || user.name}
                                        className="border-b"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        transition={{ duration: 0.3, delay: i * 0.05 }}
                                    >
                                        <td className="p-4 font-medium">{user.name}</td>
                                        <td className="p-4">{user.service || 'pppoe'}</td>
                                        <td className="p-4">{formatUptime(user.uptime)}</td>
                                        <td className="p-4 font-mono">
                                          {user.currentAddress || user['remote-address'] ? (
                                            <a
                                              href={`http://${user.currentAddress || user['remote-address']}`}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="text-primary hover:underline"
                                            >
                                              {user.currentAddress || user['remote-address']}
                                            </a>
                                          ) : (
                                            'N/A'
                                          )}
                                        </td>
                                    </motion.tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan={4} className="text-center p-10 text-muted-foreground">
                                        Tidak ada pengguna PPPoE yang aktif.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </CardContent>
        </Card>
    );
};

export default PppoeTable;