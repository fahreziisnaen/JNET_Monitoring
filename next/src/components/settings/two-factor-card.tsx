'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, ShieldOff, Loader2, Copy, Download, RefreshCw } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/utils/api';
import { toast } from 'sonner';

type Step = 'idle' | 'password' | 'scan' | 'codes' | 'disable' | 'regenerate';

const inputClass = 'w-full p-2 rounded-md bg-input border-border';

const TwoFactorCard = () => {
    const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
    const [status, setStatus] = useState<{ enabled: boolean; recoveryCodesRemaining: number } | null>(null);
    const [step, setStep] = useState<Step>('idle');
    const [password, setPassword] = useState('');
    const [code, setCode] = useState('');
    const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
    const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const fetchStatus = useCallback(async () => {
        try {
            const res = await apiFetch(`${apiUrl}/api/user/2fa`);
            if (res.ok) setStatus(await res.json());
        } catch (err) {
            console.error('Gagal memuat status 2FA:', err);
        }
    }, [apiUrl]);

    useEffect(() => { fetchStatus(); }, [fetchStatus]);

    const reset = (next: Step = 'idle') => {
        setStep(next);
        setPassword('');
        setCode('');
        setError('');
    };

    const post = async (path: string, body: object) => {
        setLoading(true);
        setError('');
        try {
            const res = await apiFetch(`${apiUrl}/api/user/2fa/${path}`, { method: 'POST', body: JSON.stringify(body) });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Permintaan gagal.');
            return data;
        } catch (err: any) {
            setError(err.message);
            return null;
        } finally {
            setLoading(false);
        }
    };

    const handleStartSetup = async (e: React.FormEvent) => {
        e.preventDefault();
        const data = await post('setup', { password });
        if (data) {
            setSetup(data);
            reset('scan');
        }
    };

    const handleEnable = async (e: React.FormEvent) => {
        e.preventDefault();
        const data = await post('enable', { code });
        if (data) {
            setRecoveryCodes(data.recoveryCodes);
            setSetup(null);
            reset('codes');
            toast.success('2FA aktif', { description: 'Mulai login berikutnya, kode Authenticator akan diminta.' });
        }
    };

    const handleRegenerate = async (e: React.FormEvent) => {
        e.preventDefault();
        const data = await post('recovery-codes', { code });
        if (data) {
            setRecoveryCodes(data.recoveryCodes);
            reset('codes');
        }
    };

    const handleDisable = async (e: React.FormEvent) => {
        e.preventDefault();
        const data = await post('disable', { password, code });
        if (data) {
            reset();
            toast.success('2FA dinonaktifkan');
            fetchStatus();
        }
    };

    const copyCodes = async () => {
        try {
            await navigator.clipboard.writeText(recoveryCodes.join('\n'));
            toast.success('Kode cadangan disalin');
        } catch {
            toast.error('Gagal menyalin', { description: 'Salin manual kode di atas.' });
        }
    };

    const downloadCodes = () => {
        const blob = new Blob([`Kode cadangan JNET Monitoring\nSetiap kode hanya bisa dipakai sekali.\n\n${recoveryCodes.join('\n')}\n`], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'jnet-kode-cadangan.txt';
        link.click();
        URL.revokeObjectURL(url);
    };

    const codeInput = (placeholder: string) => (
        <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={placeholder}
            className={`${inputClass} font-mono tracking-widest`}
            autoComplete="one-time-code"
            maxLength={9}
            required
        />
    );

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    Verifikasi 2 Langkah (2FA)
                    {status?.enabled && (
                        <span className="text-[10px] bg-green-500/10 text-green-600 px-2 py-0.5 rounded-full uppercase font-bold tracking-wider">Aktif</span>
                    )}
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                    Lindungi akun dengan kode dari Google Authenticator (atau aplikasi TOTP lain) setiap login.
                </p>
            </CardHeader>
            <CardContent className="space-y-4">
                {!status ? (
                    <div className="flex justify-center p-4"><Loader2 className="animate-spin" /></div>
                ) : step === 'codes' ? (
                    <div className="space-y-4">
                        <p className="text-sm">
                            Simpan kode cadangan ini di tempat aman. Kode dipakai saat HP hilang dan <strong>hanya ditampilkan sekali</strong>.
                        </p>
                        <div className="grid grid-cols-2 gap-2 p-4 rounded-lg bg-secondary font-mono text-sm text-center">
                            {recoveryCodes.map(c => <span key={c}>{c}</span>)}
                        </div>
                        <div className="flex flex-wrap gap-2 justify-end">
                            <Button type="button" variant="outline" onClick={copyCodes}><Copy size={14} className="mr-2" />Salin</Button>
                            <Button type="button" variant="outline" onClick={downloadCodes}><Download size={14} className="mr-2" />Unduh .txt</Button>
                            <Button type="button" onClick={() => { setRecoveryCodes([]); reset(); fetchStatus(); }}>Sudah Saya Simpan</Button>
                        </div>
                    </div>
                ) : step === 'password' ? (
                    <form onSubmit={handleStartSetup} className="space-y-3">
                        <label htmlFor="two-factor-password" className="block text-sm font-medium text-muted-foreground">Masukkan password untuk melanjutkan</label>
                        <input id="two-factor-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} required autoFocus />
                        {error && <p className="text-sm text-destructive">{error}</p>}
                        <div className="flex gap-2 justify-end">
                            <Button type="button" variant="outline" onClick={() => reset()}>Batal</Button>
                            <Button type="submit" disabled={loading}>{loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Lanjut</Button>
                        </div>
                    </form>
                ) : step === 'scan' && setup ? (
                    <form onSubmit={handleEnable} className="space-y-4">
                        <ol className="text-sm space-y-1 list-decimal list-inside">
                            <li>Buka Google Authenticator, pilih tambah akun lalu <strong>Pindai kode QR</strong>.</li>
                            <li>Masukkan 6 digit kode yang muncul di aplikasi.</li>
                        </ol>
                        <div className="flex flex-col sm:flex-row items-center gap-4">
                            <div className="bg-white p-3 rounded-lg shrink-0">
                                <QRCodeSVG value={setup.otpauthUrl} size={168} />
                            </div>
                            <div className="text-xs text-muted-foreground space-y-1 w-full min-w-0">
                                <p>Tidak bisa memindai? Masukkan kunci ini secara manual:</p>
                                <p className="font-mono text-foreground break-all bg-secondary p-2 rounded">{setup.secret.match(/.{1,4}/g)?.join(' ')}</p>
                            </div>
                        </div>
                        <input
                            type="text"
                            inputMode="numeric"
                            value={code}
                            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                            placeholder="Kode 6 digit"
                            className={`${inputClass} font-mono tracking-widest text-center text-lg`}
                            maxLength={6}
                            required
                        />
                        {error && <p className="text-sm text-destructive">{error}</p>}
                        <div className="flex gap-2 justify-end">
                            <Button type="button" variant="outline" onClick={() => { setSetup(null); reset(); }}>Batal</Button>
                            <Button type="submit" disabled={loading}>{loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Aktifkan</Button>
                        </div>
                    </form>
                ) : step === 'disable' ? (
                    <form onSubmit={handleDisable} className="space-y-3">
                        <p className="text-sm text-muted-foreground">Masukkan password dan kode Authenticator (atau kode cadangan) untuk menonaktifkan 2FA.</p>
                        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" className={inputClass} required autoFocus />
                        {codeInput('Kode 2FA')}
                        {error && <p className="text-sm text-destructive">{error}</p>}
                        <div className="flex gap-2 justify-end">
                            <Button type="button" variant="outline" onClick={() => reset()}>Batal</Button>
                            <Button type="submit" variant="destructive" disabled={loading}>{loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Nonaktifkan</Button>
                        </div>
                    </form>
                ) : step === 'regenerate' ? (
                    <form onSubmit={handleRegenerate} className="space-y-3">
                        <p className="text-sm text-muted-foreground">Masukkan kode Authenticator. Semua kode cadangan lama akan diganti.</p>
                        {codeInput('Kode 2FA')}
                        {error && <p className="text-sm text-destructive">{error}</p>}
                        <div className="flex gap-2 justify-end">
                            <Button type="button" variant="outline" onClick={() => reset()}>Batal</Button>
                            <Button type="submit" disabled={loading}>{loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Buat Kode Baru</Button>
                        </div>
                    </form>
                ) : status.enabled ? (
                    <div className="space-y-3">
                        <div className="flex items-center gap-3 p-3 rounded-lg bg-green-500/5 border border-green-500/20">
                            <ShieldCheck className="text-green-600 shrink-0" />
                            <div className="text-sm">
                                <p className="font-medium">Akun dilindungi 2FA</p>
                                <p className={`text-xs ${status.recoveryCodesRemaining <= 3 ? 'text-destructive' : 'text-muted-foreground'}`}>
                                    Sisa {status.recoveryCodesRemaining} kode cadangan
                                </p>
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-2 justify-end">
                            <Button type="button" variant="outline" onClick={() => reset('regenerate')}><RefreshCw size={14} className="mr-2" />Kode Cadangan Baru</Button>
                            <Button type="button" variant="outline" className="text-destructive" onClick={() => reset('disable')}><ShieldOff size={14} className="mr-2" />Nonaktifkan</Button>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <p className="text-sm text-muted-foreground">2FA belum aktif. Tanpa 2FA, lupa password hanya bisa direset oleh Super Admin.</p>
                        <Button type="button" onClick={() => reset('password')} className="shrink-0"><ShieldCheck size={16} className="mr-2" />Aktifkan 2FA</Button>
                    </div>
                )}
            </CardContent>
        </Card>
    );
};

export default TwoFactorCard;
