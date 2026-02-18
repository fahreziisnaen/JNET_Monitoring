'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, User, KeyRound, Loader2, Send, CheckCircle2 } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';

const ForgotPasswordPage = () => {
    const [step, setStep] = useState(1); // 1: Request OTP, 2: Reset Password
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState({ type: '', text: '' });
    const [username, setUsername] = useState('');

    const handleRequestOtp = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setLoading(true);
        setMessage({ type: '', text: '' });

        const formData = new FormData(e.currentTarget);
        const userVal = formData.get('username') as string;
        setUsername(userVal);

        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
            const res = await fetch(`${apiUrl}/api/auth/forgot-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: userVal }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message);

            setMessage({ type: 'success', text: data.message });
            setStep(2);
        } catch (err: any) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setLoading(false);
        }
    };

    const handleResetPassword = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setLoading(true);
        setMessage({ type: '', text: '' });

        const formData = new FormData(e.currentTarget);
        const data = Object.fromEntries(formData.entries());

        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
            const res = await fetch(`${apiUrl}/api/auth/reset-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...data, username }),
            });
            const resData = await res.json();
            if (!res.ok) throw new Error(resData.message);

            setMessage({ type: 'success', text: resData.message });
            setStep(3); // Success state
        } catch (err: any) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen w-full flex bg-background">
            <div className="hidden lg:flex lg:w-1/2 items-center justify-center bg-gradient-to-br from-purple-600 to-blue-600 p-12 text-white">
                <div className="text-center">
                    <h1 className="text-6xl font-black tracking-wider">JNET</h1>
                    <p className="text-xl tracking-[0.3em] opacity-80">Monitoring System</p>
                </div>
            </div>

            <div className="w-full lg:w-1/2 flex items-center justify-center p-6 sm:p-12">
                <div className="w-full max-w-sm">
                    <Link href="/login" className="inline-flex items-center text-sm text-muted-foreground hover:text-primary mb-8 transition-colors">
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Kembali ke Login
                    </Link>

                    {step === 1 && (
                        <div className="space-y-6">
                            <div>
                                <h1 className="text-4xl font-bold">Lupa Password?</h1>
                                <p className="text-muted-foreground mt-2">Masukkan username Anda untuk menerima kode OTP melalui WhatsApp.</p>
                            </div>

                            <form onSubmit={handleRequestOtp} className="space-y-4">
                                <div className="relative">
                                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                                    <input name="username" type="text" placeholder="Username" className="w-full p-3 pl-10 rounded-lg bg-input" required />
                                </div>

                                {message.text && message.type === 'error' && <p className="text-sm text-destructive text-center">{message.text}</p>}

                                <Button type="submit" className="w-full flex items-center justify-center gap-2" disabled={loading}>
                                    {loading ? <Loader2 className="animate-spin" size={20} /> : <Send size={20} />}
                                    <span>Kirim OTP</span>
                                </Button>
                            </form>
                        </div>
                    )}

                    {step === 2 && (
                        <div className="space-y-6">
                            <div>
                                <h1 className="text-4xl font-bold">Reset Password</h1>
                                <p className="text-muted-foreground mt-2">Kode OTP telah dikirim ke nomor WhatsApp terdaftar Anda.</p>
                            </div>

                            <form onSubmit={handleResetPassword} className="space-y-4">
                                <div className="relative">
                                    <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                                    <input name="otp" type="text" placeholder="Kode OTP" className="w-full p-3 pl-10 rounded-lg bg-input" required maxLength={6} />
                                </div>
                                <div className="relative">
                                    <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                                    <input name="newPassword" type="password" placeholder="Password Baru" className="w-full p-3 pl-10 rounded-lg bg-input" required />
                                </div>

                                {message.text && (
                                    <p className={`text-sm text-center ${message.type === 'error' ? 'text-destructive' : 'text-green-500'}`}>
                                        {message.text}
                                    </p>
                                )}

                                <Button type="submit" className="w-full flex items-center justify-center gap-2" disabled={loading}>
                                    {loading ? <Loader2 className="animate-spin" size={20} /> : <CheckCircle2 size={20} />}
                                    <span>Reset Password</span>
                                </Button>
                            </form>
                        </div>
                    )}

                    {step === 3 && (
                        <div className="text-center space-y-6">
                            <div className="flex justify-center">
                                <div className="h-20 w-20 bg-green-500/10 rounded-full flex items-center justify-center">
                                    <CheckCircle2 size={48} className="text-green-500" />
                                </div>
                            </div>
                            <div>
                                <h1 className="text-3xl font-bold">Berhasil!</h1>
                                <p className="text-muted-foreground mt-2">{message.text}</p>
                            </div>
                            <Link
                                href="/login"
                                className={buttonVariants({ className: "w-full" })}
                            >
                                Login Sekarang
                            </Link>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ForgotPasswordPage;
