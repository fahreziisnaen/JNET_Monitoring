'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from '@/components/motion';
import { X, ShieldCheck, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/auth-provider';
import { toast } from 'sonner';

interface TwoFactorLoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  challengeToken: string;
}

const TwoFactorLoginModal: React.FC<TwoFactorLoginModalProps> = ({ isOpen, onClose, challengeToken }) => {
  const [code, setCode] = useState('');
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();
  const { login, checkLoggedIn } = useAuth();

  useEffect(() => {
    if (isOpen) {
      setCode('');
      setError('');
      setUseRecoveryCode(false);
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
      const res = await fetch(`${apiUrl}/api/auth/login/2fa`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeToken, code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Verifikasi gagal.');

      if (data.token) {
        try {
          localStorage.setItem('auth_token', data.token);
        } catch {
          // localStorage diblokir browser; cookie tetap dipakai
        }
      }

      if (data.usedRecoveryCode) {
        toast.warning('Kode cadangan dipakai', {
          description: `Sisa ${data.recoveryCodesRemaining} kode cadangan. Buat kode baru di Pengaturan > Keamanan bila hampir habis.`,
        });
      }

      login(data.user);
      await checkLoggedIn();
      onClose();
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Verifikasi gagal.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-[1002] p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 50, opacity: 0 }}
            transition={{ type: 'spring', damping: 20, stiffness: 300 }}
            className="bg-card text-card-foreground rounded-2xl shadow-2xl w-full max-w-sm text-center border"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex justify-end p-2">
              <button type="button" onClick={onClose} className="p-1 rounded-full hover:bg-secondary">
                <X size={20} />
              </button>
            </header>
            <div className="p-6 pt-0">
              <ShieldCheck className="mx-auto h-12 w-12 text-primary" />
              <h2 className="text-2xl font-bold mt-4">Verifikasi 2 Langkah</h2>
              <p className="text-sm text-muted-foreground mt-2">
                {useRecoveryCode
                  ? 'Masukkan salah satu kode cadangan Anda (format XXXX-XXXX). Setiap kode hanya bisa dipakai sekali.'
                  : 'Masukkan 6 digit kode dari aplikasi Google Authenticator di HP Anda.'}
              </p>
              <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                {useRecoveryCode ? (
                  <input
                    type="text"
                    placeholder="XXXX-XXXX"
                    maxLength={9}
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    className="w-full p-4 text-center text-2xl tracking-widest font-mono rounded-lg bg-input border-transparent focus:ring-2 focus:ring-ring"
                    autoComplete="off"
                    required
                  />
                ) : (
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="______"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    className="w-full p-4 text-center text-3xl tracking-[1rem] font-mono rounded-lg bg-input border-transparent focus:ring-2 focus:ring-ring"
                    autoComplete="one-time-code"
                    autoFocus
                    required
                  />
                )}
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? <Loader2 className="animate-spin" /> : 'Verifikasi & Masuk'}
                </Button>
                <button
                  type="button"
                  onClick={() => { setUseRecoveryCode(!useRecoveryCode); setCode(''); setError(''); }}
                  className="text-xs text-primary hover:underline"
                >
                  {useRecoveryCode ? 'Pakai kode Authenticator' : 'HP tidak ada? Pakai kode cadangan'}
                </button>
              </form>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default TwoFactorLoginModal;
