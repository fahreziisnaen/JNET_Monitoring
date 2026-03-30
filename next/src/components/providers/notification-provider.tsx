'use client';

import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { Toast, ToastContainer } from '@/components/ui/toast';
import { useMikrotik } from './mikrotik-provider';
import { useAuth, publicPaths } from './auth-provider';
import { usePathname, useRouter } from 'next/navigation';

export interface NotificationItem {
  id: number | string;
  type: 'disconnect' | 'reconnect' | 'device_offline' | 'device_online' | 'cpu_alarm' | string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

interface NotificationContextType {
  showToast: (toast: Omit<Toast, 'id'>) => void;
  disconnectCount: number;
  clearDisconnectCount: () => void;
  notifications: NotificationItem[];
  fetchNotifications: () => void;
  markAsRead: () => void;
}

const NotificationContext = createContext<NotificationContextType | null>(null);

export const useNotification = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotification must be used within NotificationProvider');
  }
  return context;
};

export const NotificationProvider = ({ children }: { children: React.ReactNode }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [disconnectCount, setDisconnectCount] = useState(0);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const { pppoeSecrets } = useMikrotik() || { pppoeSecrets: [] };
  const { user, token } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const previousActiveRef = useRef<Set<string>>(new Set());
  const lastNotificationTimeRef = useRef<Map<string, number>>(new Map());
  const isInitializedRef = useRef<boolean>(false);
  const notificationCooldown = 60000;

  const shouldShowNotification = !publicPaths.includes(pathname);
  const pppoeActive = pppoeSecrets.filter((secret: any) => secret.isActive === true);

  const fetchNotifications = useCallback(async () => {
    if (!token) return;
    try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/api/notifications`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (response.ok) {
            const data = await response.json();
            setNotifications(data);
            setDisconnectCount(data.filter((n: any) => !n.is_read).length);
        }
    } catch (e) {
        console.error('Failed to fetch notifications:', e);
    }
  }, [token]);

  useEffect(() => {
      fetchNotifications();
  }, [fetchNotifications]);

  useEffect(() => {
    if (!user || !pppoeActive || pppoeActive.length === 0) {
      isInitializedRef.current = false;
      previousActiveRef.current = new Set();
    }
  }, [user, pppoeActive]);

  useEffect(() => {
    const handleDowntimeNotification = (event: CustomEvent) => {
      const { notifications: wsNotifs, deviceName } = event.detail;
      if (!wsNotifs || !Array.isArray(wsNotifs) || wsNotifs.length === 0) return;

      if (!shouldShowNotification) return;

      playBeepSound();

      const newNotifications: NotificationItem[] = [];
      
      wsNotifs.forEach((notif: any) => {
        newNotifications.push({
          id: `tmp-${Date.now()}-${Math.random()}`,
          type: 'disconnect',
          title: 'PPPoE User Disconnected',
          message: `${notif.userName} terputus dari jaringan pada perangkat ${deviceName}.`,
          is_read: false,
          created_at: new Date().toISOString()
        });

        // Show toast
        showToast({
          type: 'warning',
          title: 'PPPoE User Disconnected',
          message: `${notif.userName} disconnected`,
          duration: 5000,
          onClick: () => router.push('/notifications')
        });
      });

      setDisconnectCount((prev) => prev + newNotifications.length);
      setNotifications((prev) => [...newNotifications, ...prev]);
    };

    const handleReconnectNotification = (event: CustomEvent) => {
      const { notifications: wsNotifs, deviceName } = event.detail;
      if (!wsNotifs || !Array.isArray(wsNotifs) || wsNotifs.length === 0) return;
      if (!shouldShowNotification) return;

      const newNotifications: NotificationItem[] = [];
      
      wsNotifs.forEach((notif: any) => {
        newNotifications.push({
          id: `tmp-${Date.now()}-${Math.random()}`,
          type: 'reconnect',
          title: 'PPPoE User Reconnected',
          message: `${notif.userName} kembali terhubung pada perangkat ${deviceName}.`,
          is_read: false,
          created_at: new Date().toISOString()
        });

        // Show toast
        showToast({
          type: 'success',
          title: 'PPPoE User Reconnected',
          message: `${notif.userName} is back online`,
          duration: 5000,
          onClick: () => router.push('/notifications')
        });
      });

      setDisconnectCount((prev) => prev + newNotifications.length);
      setNotifications((prev) => [...newNotifications, ...prev]);
    };

    window.addEventListener('downtime-notification', handleDowntimeNotification as EventListener);
    window.addEventListener('reconnect-notification', handleReconnectNotification as EventListener);

    return () => {
      window.removeEventListener('downtime-notification', handleDowntimeNotification as EventListener);
      window.removeEventListener('reconnect-notification', handleReconnectNotification as EventListener);
    };
  }, [shouldShowNotification, router]);

  const playBeepSound = useCallback(() => {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.value = 800; // Frequency in Hz
      oscillator.type = 'sine';
      
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
      
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.3);
    } catch (e) {
      console.warn('Failed to play sound:', e);
    }
  }, []);

  const showToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).substring(7);
    setToasts((prev) => {
      const newToasts = [...prev, { ...toast, id }];
      return newToasts.slice(-3);
    });
    return id;
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    if (!pppoeActive || !Array.isArray(pppoeActive)) {
      return;
    }

    const currentActive = new Set(pppoeActive.map((u: any) => u.name));
    const previousActive = previousActiveRef.current;

    if (!isInitializedRef.current || previousActive.size === 0) {
      previousActiveRef.current = currentActive;
      isInitializedRef.current = true;
      return;
    }

    const newlyDisconnected = Array.from(previousActive).filter((name) => !currentActive.has(name));
    
    if (previousActive.size > 0 && newlyDisconnected.length > 0) {
        const now = Date.now();
        const validDisconnects: string[] = [];

        newlyDisconnected.forEach((userName) => {
          const lastNotifTime = lastNotificationTimeRef.current.get(userName) || 0;
          if (now - lastNotifTime > notificationCooldown) {
            validDisconnects.push(userName);
            lastNotificationTimeRef.current.set(userName, now);
          }
        });
    }
    
    if (previousActive.size > 0 || currentActive.size > 0) {
      previousActiveRef.current = currentActive;
    }
  }, [pppoeActive, showToast, user?.whatsapp_number, playBeepSound]);

  const clearDisconnectCount = useCallback(() => {
    setDisconnectCount(0);
  }, []);

  const markAsRead = useCallback(async () => {
    if (!token) return;
    try {
        await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/api/notifications/mark-read`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
             },
             body: JSON.stringify({}) // all read
        });
        setDisconnectCount(0);
        setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    } catch (e) {
        console.error('Failed to mark notifications as read', e);
    }
  }, [token]);

  return (
    <NotificationContext.Provider
      value={{ 
        showToast, 
        disconnectCount, 
        clearDisconnectCount, 
        notifications,
        fetchNotifications,
        markAsRead 
      }}
    >
      {children}
      <ToastContainer toasts={toasts} onClose={removeToast} />
    </NotificationContext.Provider>
  );
};
