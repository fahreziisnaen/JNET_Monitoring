'use client';

import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { Toast, ToastContainer } from '@/components/ui/toast';
import { useMikrotik } from './mikrotik-provider';
import { useAuth } from './auth-provider';
import { apiFetch } from '@/utils/api';

interface NotificationItem {
  id: string;
  type: 'disconnect' | 'reconnect';
  userName: string;
  timestamp: Date;
  duration?: number; // Duration in seconds for reconnect
}

interface NotificationContextType {
  showToast: (toast: Omit<Toast, 'id'>) => void;
  disconnectCount: number;
  clearDisconnectCount: () => void;
  notifications: NotificationItem[];
  clearNotifications: () => void;
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
  const { user } = useAuth();
  const previousActiveRef = useRef<Set<string>>(new Set());
  const lastNotificationTimeRef = useRef<Map<string, number>>(new Map());
  const isInitializedRef = useRef<boolean>(false); // Flag untuk track apakah sudah initialized
  const notificationCooldown = 60000; // 1 menit cooldown per user
  
  // Filter hanya yang aktif dari pppoeSecrets
  const pppoeActive = pppoeSecrets.filter((secret: any) => secret.isActive === true);

  // Reset initialization flag saat user logout atau pppoeActive menjadi kosong/null
  useEffect(() => {
    if (!user || !pppoeActive || pppoeActive.length === 0) {
      isInitializedRef.current = false;
      previousActiveRef.current = new Set();
    }
  }, [user, pppoeActive]);

    // Listen untuk downtime notifications dari WebSocket
  useEffect(() => {
    const handleDowntimeNotification = (event: CustomEvent) => {
      const { notifications } = event.detail;
      
      if (!notifications || !Array.isArray(notifications) || notifications.length === 0) {
        return;
      }

      console.log('[Notification] Menerima downtime notification dari backend:', notifications);

      // Play sound alert
      playBeepSound();

      // Process setiap notifikasi
      const newNotifications: NotificationItem[] = [];
      
      notifications.forEach((notif: any) => {
        const durationMinutes = Math.floor((notif.duration || 0) / 60);
        const durationSeconds = (notif.duration || 0) % 60;
        
        // Add to notifications list
        newNotifications.push({
          id: `${notif.userName}-${Date.now()}-disconnect`,
          type: 'disconnect',
          userName: notif.userName,
          timestamp: new Date(notif.startTime || new Date()),
          duration: notif.duration,
        });

        // Show toast notification
        showToast({
          type: 'warning',
          title: 'PPPoE User Disconnected',
          message: `${notif.userName} disconnected (${durationMinutes}m ${durationSeconds}s)`,
          duration: 5000,
        });
      });

      // Update disconnect count
      setDisconnectCount((prev) => prev + newNotifications.length);

      // Add to notifications list
      setNotifications((prev) => [...newNotifications, ...prev]);
    };

    const handleReconnectNotification = (event: CustomEvent) => {
      const { notifications } = event.detail;
      
      if (!notifications || !Array.isArray(notifications) || notifications.length === 0) {
        return;
      }

      console.log('[Notification] Menerima reconnect notification dari backend:', notifications);

      // Process setiap notifikasi
      const newNotifications: NotificationItem[] = [];
      
      notifications.forEach((notif: any) => {
        const durationMinutes = Math.floor((notif.duration || 0) / 60);
        const durationSeconds = (notif.duration || 0) % 60;
        
        // Add to notifications list
        newNotifications.push({
          id: `${notif.userName}-${Date.now()}-reconnect`,
          type: 'reconnect',
          userName: notif.userName,
          timestamp: new Date(notif.reconnectTime || new Date()),
          duration: notif.duration,
        });

        // Show toast notification
        showToast({
          type: 'success',
          title: 'PPPoE User Reconnected',
          message: `${notif.userName} is back online (downtime: ${durationMinutes}m ${durationSeconds}s)`,
          duration: 5000,
        });
      });

      // Add to notifications list
      setNotifications((prev) => [...newNotifications, ...prev]);
    };

    window.addEventListener('downtime-notification', handleDowntimeNotification as EventListener);
    window.addEventListener('reconnect-notification', handleReconnectNotification as EventListener);

    return () => {
      window.removeEventListener('downtime-notification', handleDowntimeNotification as EventListener);
      window.removeEventListener('reconnect-notification', handleReconnectNotification as EventListener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty deps karena showToast dan playBeepSound sudah stable

  // Function to play beep sound using Web Audio API
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
    console.log('[Notification] Creating toast:', { ...toast, id });
    setToasts((prev) => {
      const newToasts = [...prev, { ...toast, id }];
      console.log('[Notification] Total toasts:', newToasts.length);
      return newToasts;
    });
    return id;
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Detect PPPoE user disconnections and reconnections
  useEffect(() => {
    if (!pppoeActive || !Array.isArray(pppoeActive)) {
      return;
    }

    const currentActive = new Set(pppoeActive.map((u: any) => u.name));
    const previousActive = previousActiveRef.current;

    // Initialize previousActive on first load if empty
    // JANGAN trigger notification saat initial load atau saat belum initialized
    if (!isInitializedRef.current || previousActive.size === 0) {
      console.log('[Notification] Initial load, setting previousActive tanpa trigger notification', {
        isInitialized: isInitializedRef.current,
        previousSize: previousActive.size,
        currentSize: currentActive.size
      });
      previousActiveRef.current = currentActive;
      isInitializedRef.current = true;
      return;
    }

    // Detect changes
    const newlyDisconnected = Array.from(previousActive).filter(
      (name) => !currentActive.has(name)
    );
    
    const newlyReconnected = Array.from(currentActive).filter(
      (name) => !previousActive.has(name)
    );

    // Debug logging
    if (newlyDisconnected.length > 0 || newlyReconnected.length > 0) {
      console.log('[Notification] Changes detected:', {
        disconnected: newlyDisconnected,
        reconnected: newlyReconnected,
        previousCount: previousActive.size,
        currentCount: currentActive.size
      });
    }

    // Handle disconnections (only if we have previous data AND it's not initial load)
    // Pastikan previousActive tidak kosong dan ada perubahan yang valid
    if (previousActive.size > 0 && newlyDisconnected.length > 0) {
        const now = Date.now();
        const validDisconnects: string[] = [];

        // Filter berdasarkan cooldown
        newlyDisconnected.forEach((userName) => {
          const lastNotifTime = lastNotificationTimeRef.current.get(userName) || 0;
          if (now - lastNotifTime > notificationCooldown) {
            validDisconnects.push(userName);
            lastNotificationTimeRef.current.set(userName, now);
          }
        });

        // Catatan: Toast notification untuk disconnect TIDAK langsung ditampilkan
        // Notifikasi disconnect (toast + WhatsApp) akan dikirim oleh backend setelah downtime mencapai 2 menit
        // Notifikasi akan diterima via WebSocket dengan type 'downtime-notification'
        // Ini untuk menghindari spam notifikasi untuk disconnect yang cepat reconnect
    }
    
    // Catatan: Toast notification untuk reconnect TIDAK langsung ditampilkan
    // Notifikasi reconnect (toast + WhatsApp) akan dikirim oleh backend hanya jika downtime sebelumnya >= 2 menit
    // Notifikasi akan diterima via WebSocket dengan type 'reconnect-notification'
    // Ini konsisten dengan disconnect notification yang hanya dikirim setelah 2 menit

    // Update previous active users hanya jika ada perubahan yang valid
    // Jangan update jika ini adalah initial load (previousActive kosong)
    if (previousActive.size > 0 || currentActive.size > 0) {
      previousActiveRef.current = currentActive;
    }
  }, [pppoeActive, showToast, user?.whatsapp_number, playBeepSound]);

  const clearDisconnectCount = useCallback(() => {
    setDisconnectCount(0);
  }, []);

  const clearNotifications = useCallback(() => {
    setNotifications([]);
    setDisconnectCount(0);
  }, []);

  const markAsRead = useCallback(() => {
    setDisconnectCount(0);
  }, []);

  return (
    <NotificationContext.Provider
      value={{ 
        showToast, 
        disconnectCount, 
        clearDisconnectCount, 
        notifications,
        clearNotifications,
        markAsRead
      }}
    >
      {children}
      <ToastContainer toasts={toasts} onClose={removeToast} />
    </NotificationContext.Provider>
  );
};

