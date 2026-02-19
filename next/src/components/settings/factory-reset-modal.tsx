'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from '@/components/motion';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface FactoryResetModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => Promise<void>;
    isLoading: boolean;
}

const FactoryResetModal = ({ isOpen, onClose, onConfirm, isLoading }: FactoryResetModalProps) => {
    const [confirmText, setConfirmText] = useState('');
    const isConfirmEnabled = confirmText === 'RESET';

    const handleClose = () => {
        if (!isLoading) {
            setConfirmText('');
            onClose();
        }
    };

    const handleConfirm = async () => {
        if (!isConfirmEnabled || isLoading) return;
        await onConfirm();
        setConfirmText('');
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 bg-black/70 flex items-center justify-center z-[1002] p-4"
                    onClick={handleClose}
                >
                    <motion.div
                        initial={{ y: 50, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: 50, opacity: 0 }}
                        transition={{ type: 'spring', damping: 20, stiffness: 300 }}
                        className="bg-card rounded-2xl shadow-2xl w-full max-w-md border border-red-500/50"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <header className="p-6 pb-4">
                            <h2 className="text-xl font-bold flex items-center gap-3 text-red-500">
                                <AlertTriangle className="h-6 w-6" />
                                Factory Reset Workspace
                            </h2>
                        </header>

                        {/* Body */}
                        <div className="px-6 pb-4 space-y-4">
                            <p className="text-sm font-semibold text-foreground">
                                Tindakan ini akan menghapus semua data operasional workspace secara permanen.
                            </p>

                            <div className="grid grid-cols-2 gap-3 text-xs">
                                <div className="bg-red-900/20 border border-red-500/20 rounded-lg p-3 space-y-1">
                                    <p className="font-semibold text-red-400">🗑️ Data yang dihapus:</p>
                                    <ul className="text-muted-foreground space-y-0.5">
                                        <li>• Konfigurasi perangkat Mikrotik</li>
                                        <li>• Log penggunaan & status</li>
                                        <li>• Aset jaringan & klien</li>
                                        <li>• Semua data operasional</li>
                                    </ul>
                                </div>
                                <div className="bg-green-900/20 border border-green-500/20 rounded-lg p-3 space-y-1">
                                    <p className="font-semibold text-green-400">✅ Data yang aman:</p>
                                    <ul className="text-muted-foreground space-y-0.5">
                                        <li>• Akun & profil user</li>
                                        <li>• Data workspace</li>
                                        <li>• Sesi aktif</li>
                                    </ul>
                                </div>
                            </div>

                            <p className="text-xs text-amber-400 font-medium">
                                ⚡ Backup otomatis akan dibuat dan diunduh sebelum penghapusan.
                            </p>

                            <div className="space-y-2">
                                <label className="text-sm text-muted-foreground">
                                    Ketik <strong className="text-foreground font-mono">RESET</strong> untuk mengkonfirmasi:
                                </label>
                                <Input
                                    value={confirmText}
                                    onChange={(e) => setConfirmText(e.target.value)}
                                    placeholder="RESET"
                                    disabled={isLoading}
                                    className="font-mono"
                                />
                            </div>
                        </div>

                        {/* Footer */}
                        <footer className="flex justify-end gap-3 p-4 bg-secondary/50 rounded-b-2xl">
                            <Button type="button" variant="ghost" onClick={handleClose} disabled={isLoading}>
                                Batal
                            </Button>
                            <Button
                                type="button"
                                variant="destructive"
                                onClick={handleConfirm}
                                disabled={!isConfirmEnabled || isLoading}
                            >
                                {isLoading ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Memproses...
                                    </>
                                ) : (
                                    'Ya, Reset Sekarang'
                                )}
                            </Button>
                        </footer>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default FactoryResetModal;
