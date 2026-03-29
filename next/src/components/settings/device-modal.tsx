'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from '@/components/motion';
import { X, Server, Loader2, Plug, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/components/providers/auth-provider';
import { apiFetch } from '@/utils/api';
import { useEscKey } from '@/hooks/useEscKey';

export interface Device {
  id?: number;
  name: string;
  host: string;
  port: number;
  user: string;
  password?: string;
}

interface DeviceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  deviceToEdit?: Device | null;
}

const DeviceModal = ({ isOpen, onClose, onSuccess, deviceToEdit }: DeviceModalProps) => {
  const { user: authUser } = useAuth();
  const isEditMode = !!deviceToEdit;
  useEscKey(isOpen, onClose);

  const [formData, setFormData] = useState({
    name: '', host: '', user: '', password: '', port: 8728
  });
  const [loading, setLoading] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResultModal, setTestResultModal] = useState<{isOpen: boolean, type: 'success' | 'error', title: string, message: string}>({
      isOpen: false, type: 'success', title: '', message: ''
  });
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setError('');
      if (isEditMode && deviceToEdit) {
        setFormData({
          name: deviceToEdit.name,
          host: deviceToEdit.host,
          user: deviceToEdit.user,
          port: deviceToEdit.port,
          password: '',
        });
      } else {
        setFormData({ name: '', host: '', user: '', password: '', port: 8728 });
      }
    }
  }, [isOpen, deviceToEdit, isEditMode]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Cek apakah user sudah login
    if (!authUser) {
        setError("Error: Anda belum login. Silakan login ulang.");
        return;
    }
    
    // Biarkan backend yang handle workspace_id
    // Middleware sudah punya safeguard untuk membuat workspace otomatis
    setLoading(true);
    setError('');

    const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
    const url = isEditMode
        ? `${apiUrl}/api/devices/${deviceToEdit?.id}`
        : `${apiUrl}/api/devices`;
    
    const method = isEditMode ? 'PUT' : 'POST';

    try {
        const res = await apiFetch(url, {
            method: method,
            body: JSON.stringify(formData)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Operasi gagal.");
        
        onSuccess();
        onClose();
    } catch (err: any) {
        setError(err.message);
    } finally {
        setLoading(false);
    }
  };

  const handleTestConnection = async () => {
    // Validasi basic
    if (!formData.host || !formData.user || !formData.port) {
        setTestResultModal({
            isOpen: true,
            type: 'error',
            title: 'Validasi Gagal',
            message: 'Host, Port, dan Username wajib diisi untuk tes koneksi.'
        });
        return;
    }

    setIsTesting(true);
    setError('');

    try {
        const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
        const payload = { ...formData, deviceId: deviceToEdit?.id };
        
        const res = await apiFetch(`${apiUrl}/api/devices/test-connection`, {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            setTestResultModal({
                isOpen: true,
                type: 'error',
                title: 'Uji Koneksi Gagal',
                message: data.message
            });
        } else {
            setTestResultModal({
                isOpen: true,
                type: 'success',
                title: 'Uji Koneksi Sukses!',
                message: data.message
            });
        }
    } catch (err: any) {
        setTestResultModal({
            isOpen: true,
            type: 'error',
            title: 'Error Sistem',
            message: err.message || "Gagal menghubungi server untuk tes koneksi."
        });
    } finally {
        setIsTesting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-[1001] p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 50, opacity: 0 }}
            transition={{ type: 'spring', damping: 20, stiffness: 300 }}
            className="bg-card text-card-foreground rounded-2xl shadow-2xl w-full max-w-lg border"
            onClick={(e) => e.stopPropagation()}
          >
            <form onSubmit={handleSubmit}>
              <header className="flex justify-between items-center p-4 border-b">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <Server /> {isEditMode ? 'Edit Perangkat' : 'Tambah Perangkat Baru'}
                </h2>
                <button type="button" onClick={onClose} className="p-1 rounded-full hover:bg-secondary"><X size={20} /></button>
              </header>

              <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
                <div>
                  <label className="block text-sm font-medium mb-1 text-muted-foreground">Nama Perangkat</label>
                  <input type="text" name="name" placeholder="e.g., Router Kantor Pusat" value={formData.name} onChange={handleChange} className="w-full p-2 rounded-md bg-input" required />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium mb-1 text-muted-foreground">Host / IP Address</label>
                    <input type="text" name="host" placeholder="e.g., 192.168.88.1" value={formData.host} onChange={handleChange} className="w-full p-2 rounded-md bg-input" required />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1 text-muted-foreground">Port API</label>
                    <input type="number" name="port" value={formData.port} onChange={handleChange} className="w-full p-2 rounded-md bg-input" required />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium mb-1 text-muted-foreground">Username API</label>
                        <input type="text" name="user" placeholder="e.g., admin" value={formData.user} onChange={handleChange} autoComplete='off' className="w-full p-2 rounded-md bg-input" required />
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1 text-muted-foreground">Password API</label>
                        <input type="password" name="password" placeholder={isEditMode ? 'Isi untuk mengubah' : 'Password'} onChange={handleChange} autoComplete="new-password" className="w-full p-2 rounded-md bg-input" />
                    </div>
                </div>
                {error && <p className="text-sm text-center text-destructive">{error}</p>}
              </div>

              <footer className="flex justify-between items-center p-4 py-3 bg-secondary/50 rounded-b-2xl border-t">
                <Button 
                    type="button" 
                    variant="outline" 
                    onClick={handleTestConnection} 
                    disabled={isTesting || loading}
                    className="gap-2 border-primary/20 hover:bg-primary/10 hover:text-primary transition-colors"
                >
                    {isTesting ? <Loader2 className="animate-spin h-4 w-4" /> : <Plug className="h-4 w-4 text-primary" />}
                    Test Connection
                </Button>
                
                <div className="flex gap-2">
                    <Button type="button" variant="ghost" onClick={onClose} disabled={loading || isTesting}>Batal</Button>
                    <Button type="submit" disabled={loading || isTesting}>
                        {loading && <Loader2 className="animate-spin h-4 w-4 mr-2"/>}
                        {isEditMode ? 'Simpan Perubahan' : 'Tambah Perangkat'}
                    </Button>
                </div>
              </footer>
            </form>

            {/* Test Result Modal Overlay */}
            <AnimatePresence>
                {testResultModal.isOpen && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 z-[1010] bg-black/60 backdrop-blur-sm flex items-center justify-center rounded-2xl p-4"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.9, opacity: 0 }}
                            className="bg-card w-full max-w-sm rounded-xl shadow-2xl overflow-hidden border"
                        >
                            <div className={`p-6 flex flex-col items-center text-center ${testResultModal.type === 'success' ? 'bg-green-500/10' : 'bg-destructive/10'}`}>
                                {testResultModal.type === 'success' ? (
                                    <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mb-4 text-green-500">
                                        <CheckCircle2 size={32} />
                                    </div>
                                ) : (
                                    <div className="w-16 h-16 rounded-full bg-destructive/20 flex items-center justify-center mb-4 text-destructive">
                                        <AlertCircle size={32} />
                                    </div>
                                )}
                                <h3 className="text-xl font-bold mb-2">{testResultModal.title}</h3>
                                <p className="text-muted-foreground text-sm leading-relaxed mb-6">
                                    {testResultModal.message}
                                </p>
                                <Button 
                                    className="w-full" 
                                    variant={testResultModal.type === 'success' ? 'default' : 'destructive'}
                                    onClick={() => setTestResultModal({ ...testResultModal, isOpen: false })}
                                >
                                    Tutup
                                </Button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default DeviceModal;