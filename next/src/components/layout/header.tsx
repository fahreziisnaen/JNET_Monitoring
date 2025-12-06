'use client';

import Link from 'next/link';
import React, { useState, useEffect, useRef } from 'react';
import { Settings, LogOut, Share2, Bell, AlertCircle, X, CheckCircle2 } from 'lucide-react';
import GenerateCloneCodeModal from '@/components/settings/generate-clone-code-modal';
import { ThemeSwitch } from '@/components/theme-switch';
import { useAuth } from '../providers/auth-provider';
import { useNotification } from '../providers/notification-provider';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from '@/components/motion';

const Header = () => {
    const { user, logout } = useAuth();
    const { disconnectCount, notifications, clearNotifications, markAsRead } = useNotification();
    const router = useRouter();
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [isNotificationOpen, setIsNotificationOpen] = useState(false);
    const [isCloneModalOpen, setIsCloneModalOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const notificationRef = useRef<HTMLDivElement>(null);

    const handleLogout = async () => {
        setIsDropdownOpen(false);
        await logout();
    };

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsDropdownOpen(false);
            }
            if (notificationRef.current && !notificationRef.current.contains(event.target as Node)) {
                setIsNotificationOpen(false);
            }
        };

        if (isDropdownOpen || isNotificationOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isDropdownOpen, isNotificationOpen]);

    const formatTime = (date: Date) => {
        const now = new Date();
        const diff = now.getTime() - date.getTime();
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(minutes / 60);
        
        if (minutes < 1) return 'Baru saja';
        if (minutes < 60) return `${minutes} menit lalu`;
        if (hours < 24) return `${hours} jam lalu`;
        return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    };

    const formatDuration = (seconds: number) => {
        const minutes = Math.floor(seconds / 60);
        const secs = seconds % 60;
        if (minutes > 0) return `${minutes}m ${secs}s`;
        return `${secs}s`;
    };

    return (
    <>
      <header className="w-full py-2 px-4 sm:px-6 flex justify-between items-center border-b bg-card/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="flex-1" />
        <div className="flex-1 text-center">
          <Link href="/dashboard" className="inline-block">
            <h1 className="text-2xl md:text-3xl font-bold tracking-wider text-foreground">
              JNET
            </h1>
            <p className="text-sm text-muted-foreground tracking-wide -mt-1">
                Monitoring System
            </p>
          </Link>
        </div>
        <div className="flex-1 flex items-center justify-end gap-4">
            {/* Notification Bell */}
            <div className="relative" ref={notificationRef}>
              <button
                onClick={() => {
                  setIsNotificationOpen(!isNotificationOpen);
                  if (!isNotificationOpen) {
                    markAsRead();
                  }
                }}
                className="relative p-2 rounded-full hover:bg-secondary transition-colors"
                title="Notifikasi"
              >
                <Bell className="h-5 w-5 text-muted-foreground" />
                {disconnectCount > 0 && (
                  <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center animate-pulse">
                    {disconnectCount > 9 ? '9+' : disconnectCount}
                  </span>
                )}
              </button>
              
              {/* Notification Dropdown */}
              <AnimatePresence>
                {isNotificationOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="absolute top-full right-0 mt-2 w-80 bg-card rounded-lg shadow-lg border z-50 max-h-96 overflow-hidden flex flex-col"
                  >
                    <div className="p-4 border-b flex items-center justify-between">
                      <h3 className="font-semibold text-sm flex items-center gap-2">
                        <Bell size={16} />
                        Notifikasi
                      </h3>
                      {notifications.length > 0 && (
                        <button
                          onClick={clearNotifications}
                          className="text-xs text-muted-foreground hover:text-foreground"
                        >
                          Hapus semua
                        </button>
                      )}
                    </div>
                    <div className="overflow-y-auto flex-1">
                      {notifications.length === 0 ? (
                        <div className="p-8 text-center text-muted-foreground text-sm">
                          Tidak ada notifikasi
                        </div>
                      ) : (
                        <div className="divide-y">
                          {notifications.map((notif) => (
                            <div
                              key={notif.id}
                              className={`p-3 hover:bg-secondary/50 transition-colors ${
                                notif.type === 'disconnect' ? 'border-l-4 border-l-red-500' : 'border-l-4 border-l-green-500'
                              }`}
                            >
                              <div className="flex items-start gap-3">
                                <div className={`mt-0.5 ${notif.type === 'disconnect' ? 'text-red-500' : 'text-green-500'}`}>
                                  {notif.type === 'disconnect' ? (
                                    <AlertCircle size={18} />
                                  ) : (
                                    <CheckCircle2 size={18} />
                                  )}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-semibold">
                                    {notif.type === 'disconnect' ? 'PPPoE User Disconnected' : 'PPPoE User Reconnected'}
                                  </p>
                                  <p className="text-sm text-muted-foreground truncate">
                                    {notif.userName}
                                  </p>
                                  <div className="flex items-center gap-2 mt-1">
                                    <span className="text-xs text-muted-foreground">
                                      {formatTime(notif.timestamp)}
                                    </span>
                                    {notif.duration && (
                                      <span className="text-xs text-muted-foreground">
                                        • Downtime: {formatDuration(notif.duration)}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    {notifications.length > 0 && (
                      <div className="p-3 border-t">
                        <button
                          onClick={() => {
                            router.push('/management');
                            setIsNotificationOpen(false);
                          }}
                          className="w-full text-sm text-primary hover:underline"
                        >
                          Lihat semua di Management →
                        </button>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <div className="relative" ref={dropdownRef}>
                <button onClick={() => setIsDropdownOpen(prev => !prev)} className="p-1.5 rounded-full hover:bg-secondary">
                    <img 
                      src={user?.profile_picture_url ? `${process.env.NEXT_PUBLIC_API_BASE_URL}${user.profile_picture_url}` : `${process.env.NEXT_PUBLIC_API_BASE_URL}/public/uploads/avatars/default.jpg`}
                      alt="User Avatar"
                      className="w-9 h-9 rounded-full object-cover"
                      onError={(e) => {
                        // Fallback jika gambar tidak ditemukan
                        const target = e.target as HTMLImageElement;
                        target.src = `${process.env.NEXT_PUBLIC_API_BASE_URL}/public/uploads/avatars/default.jpg`;
                      }}
                    />
                </button>
                {isDropdownOpen && (
                    <div className="absolute top-full right-0 mt-2 w-60 bg-card rounded-lg shadow-lg border z-50">
                        <div className="p-3 border-b">
                            <p className="font-semibold text-sm">{user?.displayName}</p>
                            <p className="text-xs text-muted-foreground">@{user?.username || 'user'}</p>
                        </div>
                         <div className="p-2 space-y-1">
                            <Link href="/settings" onClick={() => setIsDropdownOpen(false)} className="flex items-center gap-3 w-full px-3 py-2 text-sm rounded-md hover:bg-secondary">
                              <Settings size={16} /><span>Pengaturan</span>
                            </Link>
                             <button onClick={() => { setIsCloneModalOpen(true); setIsDropdownOpen(false); }} className="flex items-center gap-3 w-full px-3 py-2 text-sm rounded-md hover:bg-secondary">
                                <Share2 size={16} /><span>Bagikan Konfigurasi</span>
                            </button>
                            <div className="pt-2 border-t"><ThemeSwitch /></div>
                            <div className="pt-1 border-t">
                                <button onClick={handleLogout} className="flex items-center gap-3 w-full px-3 py-2 text-sm text-destructive rounded-md hover:bg-destructive/10">
                                <LogOut size={16} /><span>Logout</span>
                                </button>
                            </div>
                          </div>
                    </div>
                )}
            </div>
        </div>
      </header>
      <GenerateCloneCodeModal isOpen={isCloneModalOpen} onClose={() => setIsCloneModalOpen(false)} />
    </>
  );
}
export default Header;