"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { getAuthToken } from "@/utils/api";

interface AuthContextType {
  isLoggedIn: boolean;
  user: any;
  loading: boolean;
  checkLoggedIn: () => Promise<void>;
  logout: () => Promise<void>;
  login: (user: any) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

const publicPaths = ["/login", "/register"];

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  const router = useRouter();
  const pathname = usePathname();

  const checkLoggedIn = useCallback(async () => {
    setLoading(true);
    try {
      // Gunakan helper function yang sudah ada untuk mendapatkan token dari localStorage atau cookie
      const token = getAuthToken();
      
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };
      
      // SELALU kirim Authorization header jika token ada (dari localStorage atau cookie)
      // Ini memastikan request tetap berhasil meskipun cookie tidak terkirim
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
        // Hanya log di development untuk mengurangi verbosity
        if (process.env.NODE_ENV === 'development') {
          console.log('[Auth Provider] Menggunakan token untuk Authorization header');
        }
      }
      
      // Use apiFetch untuk konsistensi, tapi tetap perlu manual header karena sudah di-set di atas
      const response = await fetch(`${apiUrl}/api/auth/me`, {
        credentials: "include",
        cache: 'no-store',
        headers,
      });
      
      if (response.ok) {
        const data = await response.json();
        setIsLoggedIn(true);
        // Pastikan user object memiliki workspace_id
        const userData = data.user ?? data;
        if (!userData.workspace_id) {
          console.warn('[Auth Provider] User tidak punya workspace_id, middleware seharusnya sudah handle ini.');
        }
        setUser(userData);
        // Hanya log di development untuk mengurangi verbosity
        if (process.env.NODE_ENV === 'development') {
          console.log('[Auth Provider] Check login berhasil, user:', userData.id);
        }
      } else {
        const errorData = await response.json().catch(() => ({}));
        console.warn('[Auth Provider] Check login failed:', response.status, errorData);
        // Hapus token dari localStorage jika unauthorized
        if (response.status === 401 && typeof window !== 'undefined') {
          try {
            localStorage.removeItem('auth_token');
            console.log('[Auth Provider] Token dihapus dari localStorage karena unauthorized');
          } catch (e) {
            // localStorage mungkin tidak tersedia, skip
            console.warn('[Auth Provider] Gagal menghapus token dari localStorage:', e);
          }
        }
        setIsLoggedIn(false);
        setUser(null);
      }
    } catch (error) {
      console.error("[Auth Provider] Check login error:", error);
      setIsLoggedIn(false);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);
  
  const logout = useCallback(async () => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem('auth_token');
      } catch (e) {
        // localStorage mungkin tidak tersedia, skip
        console.warn('[Auth Provider] Gagal menghapus token dari localStorage saat logout:', e);
      }
    }
    // Logout tidak perlu apiFetch karena ini adalah cleanup operation
    await fetch(`${apiUrl}/api/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
    setIsLoggedIn(false);
    setUser(null);
    router.push("/login");
  }, [router, apiUrl]);

  const login = useCallback((newUser: any) => {
    setIsLoggedIn(true);
    setUser(newUser);
  }, []);

  useEffect(() => {
    checkLoggedIn();
  }, [checkLoggedIn]);

  useEffect(() => {
    if (!loading && !isLoggedIn && !publicPaths.includes(pathname)) {
      router.push("/login");
    }
  }, [loading, isLoggedIn, pathname, router]);

  return (
    <AuthContext.Provider
      value={{ isLoggedIn, user, loading, checkLoggedIn, logout, login }}
    >
      {loading && !publicPaths.includes(pathname) ? (
        <div className="flex h-screen w-full items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : (
        children
      )}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
