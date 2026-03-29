'use client';

import Link from 'next/link';
import React, { useState, useEffect, useRef } from 'react';
import { Settings, LogOut, Share2, Bell, AlertCircle, X, CheckCircle2, ArrowRightLeft, Loader2 } from 'lucide-react';
import GenerateCloneCodeModal from '@/components/settings/generate-clone-code-modal';
import { ThemeSwitch } from '@/components/theme-switch';
import { useAuth } from '../providers/auth-provider';
import { useNotification } from '../providers/notification-provider';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from '@/components/motion';

const Header = () => {
  const { user, logout, token, checkLoggedIn } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { disconnectCount, notifications, markAsRead } = useNotification();
  const router = useRouter();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);
  const [isCloneModalOpen, setIsCloneModalOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const notificationRef = useRef<HTMLDivElement>(null);
  const [workspaces, setWorkspaces] = useState<any[]>([]);
  const [isSwitching, setIsSwitching] = useState(false);
  const [isWorkspaceDropdownOpen, setIsWorkspaceDropdownOpen] = useState(false);

  useEffect(() => {
    if (user?.is_super_admin && token) {
      fetchWorkspaces();
    }
  }, [user, token]);

  const fetchWorkspaces = async () => {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/api/workspaces/all`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (response.ok) {
        const data = await response.json();
        setWorkspaces(data);
      }
    } catch (error) {
      console.error("Failed to fetch workspaces", error);
    }
  };

  const handleSwitchWorkspace = async (workspaceId: number) => {
    setIsSwitching(true);
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/api/workspaces/switch/${workspaceId}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        if (typeof window !== 'undefined' && localStorage.getItem('auth_token')) {
          localStorage.setItem('auth_token', data.token);
        }
        await checkLoggedIn();
        setIsDropdownOpen(false);
        window.location.href = '/dashboard';
      } else {
        const errorData = await response.json().catch(() => ({}));
        alert(errorData.message || 'Gagal ganti workspace');
      }
    } catch (error) {
      console.error("Error switching workspace", error);
      alert('Gagal ganti workspace karena kesalahan jaringan');
    } finally {
      setIsSwitching(false);
    }
  };

  const handleLogout = async () => {
    setIsDropdownOpen(false);
    await logout();
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
        setIsWorkspaceDropdownOpen(false);
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
                if (!isNotificationOpen && disconnectCount > 0) {
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
                  </div>
                  <div className="overflow-y-auto flex-1">
                    {notifications.length === 0 ? (
                      <div className="p-8 text-center text-muted-foreground text-sm">
                        Tidak ada notifikasi
                      </div>
                    ) : (
                      <div className="divide-y">
                        {notifications.slice(0, 5).map((notif: any) => (
                          <div
                            key={notif.id}
                            onClick={() => {
                              router.push('/notifications');
                              setIsNotificationOpen(false);
                            }}
                            className={`p-3 cursor-pointer hover:bg-secondary/50 transition-colors ${
                              notif.type.includes('disconnect') || notif.type.includes('offline') || notif.type.includes('alarm')
                                ? 'border-l-4 border-l-red-500' 
                                : 'border-l-4 border-l-green-500'
                            }`}
                          >
                            <div className="flex items-start gap-3">
                              <div className={`mt-0.5 ${
                                notif.type.includes('disconnect') || notif.type.includes('offline') || notif.type.includes('alarm')
                                  ? 'text-red-500' 
                                  : 'text-green-500'
                              }`}>
                                {notif.type.includes('disconnect') || notif.type.includes('offline') || notif.type.includes('alarm') ? (
                                  <AlertCircle size={18} />
                                ) : (
                                  <CheckCircle2 size={18} />
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold flex items-center justify-between gap-1">
                                  <span>{notif.title || (notif.type === 'disconnect' ? 'PPPoE User Disconnected' : 'Notification')}</span>
                                  {notif.workspace_name && (
                                    <span className="text-[10px] font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded-full whitespace-nowrap hidden sm:inline-flex">
                                        {notif.workspace_name.length > 15 ? notif.workspace_name.substring(0, 15) + '...' : notif.workspace_name}
                                    </span>
                                  )}
                                </p>
                                <p className="text-sm text-muted-foreground truncate" title={notif.message}>
                                  {notif.message}
                                </p>
                                <div className="flex items-center gap-2 mt-1">
                                  <span className="text-xs text-muted-foreground">
                                    {formatTime(new Date(notif.created_at))}
                                  </span>
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
                          router.push('/notifications');
                          setIsNotificationOpen(false);
                        }}
                        className="w-full text-sm text-primary hover:underline font-medium"
                      >
                        Lihat semua riwayat →
                      </button>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <div className="relative" ref={dropdownRef}>
            <button onClick={() => setIsDropdownOpen(prev => !prev)} className="p-1.5 rounded-full hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-primary/50">
              <img
                src={user?.profile_picture_url ? `${process.env.NEXT_PUBLIC_API_BASE_URL}${user.profile_picture_url}` : `${process.env.NEXT_PUBLIC_API_BASE_URL}/public/uploads/avatars/default.jpg`}
                alt="User Avatar"
                className="w-9 h-9 rounded-full object-cover border border-border"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  target.src = `${process.env.NEXT_PUBLIC_API_BASE_URL}/public/uploads/avatars/default.jpg`;
                }}
              />
            </button>
            {isDropdownOpen && (
              <div className="absolute top-full right-0 mt-2 w-64 bg-card rounded-lg shadow-lg border z-50">
                <div className="p-3 border-b flex flex-col">
                  <p className="font-semibold text-sm truncate">{user?.displayName}</p>
                  <p className="text-xs text-muted-foreground truncate">@{user?.username || 'user'}</p>
                  {user?.is_super_admin && <span className="mt-1 inline-flex self-start px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary/20 text-primary">Super Admin</span>}
                </div>
                <div className="p-2 space-y-1">
                  <Link href="/settings" onClick={() => setIsDropdownOpen(false)} className="flex items-center gap-3 w-full px-3 py-2 text-sm rounded-md hover:bg-secondary">
                    <Settings size={16} /><span>Pengaturan</span>
                  </Link>
                  {isAdmin && (
                    <button onClick={() => { setIsCloneModalOpen(true); setIsDropdownOpen(false); }} className="flex items-center gap-3 w-full px-3 py-2 text-sm rounded-md hover:bg-secondary">
                      <Share2 size={16} /><span>Bagikan Konfigurasi</span>
                    </button>
                  )}
                  {user?.is_super_admin && workspaces.length > 0 && (
                    <div className="pt-2 pb-1 border-t px-1 mt-1">
                      <div className="relative">
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setIsWorkspaceDropdownOpen(!isWorkspaceDropdownOpen);
                          }}
                          className="w-full flex items-center justify-between px-3 py-2 text-sm rounded-md hover:bg-secondary text-foreground transition-colors"
                        >
                          <span className="flex items-center gap-3"><ArrowRightLeft size={16} className="text-muted-foreground" /> Ganti Workspace</span>
                          <span className={`text-muted-foreground transition-transform duration-200 text-[10px] ${isWorkspaceDropdownOpen ? 'rotate-90' : ''}`}>▶</span>
                        </button>

                        {/* Nested Dropdown for Workspaces - Responsive positioning */}
                        <AnimatePresence>
                          {isWorkspaceDropdownOpen && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2 }}
                              className="sm:absolute sm:right-full sm:top-0 sm:mr-1 sm:w-60 relative w-full mt-1 border border-primary/20 bg-secondary/20 sm:bg-card shadow-lg rounded-lg overflow-hidden z-50"
                            >
                              <div className="p-2 border-b bg-muted/30 rounded-t-lg sm:block hidden">
                                <p className="text-xs font-semibold flex items-center gap-1.5">
                                  Pilih Workspace
                                </p>
                              </div>
                              <div className="max-h-60 overflow-y-auto space-y-0.5 custom-scrollbar p-1">
                                {workspaces.map(ws => (
                                  <button
                                    key={ws.id}
                                    onClick={() => handleSwitchWorkspace(ws.id)}
                                    disabled={isSwitching || user.workspace_id === ws.id}
                                    className={`w-full text-left px-2 py-2 text-xs rounded-sm flex items-center justify-between transition-colors ${user.workspace_id === ws.id ? 'bg-primary/20 text-primary font-bold cursor-default' : 'hover:bg-secondary text-foreground'}`}
                                  >
                                    <span className="truncate mr-2 flex-1">{ws.name}</span>
                                    {user.workspace_id === ws.id ? <CheckCircle2 size={14} className="flex-shrink-0 text-primary" /> : null}
                                  </button>
                                ))}
                                {isSwitching && (
                                  <div className="flex items-center justify-center py-3 text-primary bg-secondary/30 rounded-sm">
                                    <Loader2 size={16} className="animate-spin" />
                                    <span className="ml-2 text-xs">Mengganti...</span>
                                  </div>
                                )}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                  )}
                  <div className="pt-2 border-t"><ThemeSwitch /></div>
                  <div className="pt-1 border-t">
                    <button onClick={handleLogout} className="flex items-center gap-3 w-full px-3 py-2 text-sm text-destructive rounded-md hover:bg-destructive/10 transition-colors">
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