/**
 * Helper function untuk mendapatkan token dari localStorage atau cookie
 * Fallback untuk browser yang tidak support localStorage atau block localStorage
 */
function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;

  // Coba ambil dari localStorage dulu
  try {
    const tokenFromStorage = localStorage.getItem('auth_token');
    if (tokenFromStorage) {
      return tokenFromStorage;
    }
  } catch (e) {
    // localStorage mungkin tidak tersedia atau di-block (misalnya di UC Browser)
    console.warn('[Auth Token] localStorage tidak tersedia, mencoba fallback ke cookie');
  }

  // Fallback: ambil dari cookie
  try {
    const cookies = document.cookie.split(';');
    for (let cookie of cookies) {
      const [name, value] = cookie.trim().split('=');
      if (name === 'token' && value) {
        return decodeURIComponent(value);
      }
    }
  } catch (e) {
    console.warn('[Auth Token] Gagal membaca cookie:', e);
  }

  return null;
}

/**
 * Helper function untuk membuat API request dengan authentication
 * Otomatis menambahkan Authorization header dari localStorage atau cookie
 */
export async function apiFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = getAuthToken();

  const isFormData = options.body instanceof FormData;

  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> || {}),
  };

  // Set default Content-Type if not FormData and not already set
  if (!isFormData && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  // Jika ada token, tambahkan Authorization header
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const response = await fetch(url, {
      ...options,
      credentials: 'include',
      headers: headers as HeadersInit,
      // Pastikan signal di-pass jika ada di options
      signal: options.signal,
    });

    // Log error response untuk debugging (hanya di development)
    if (!response.ok && process.env.NODE_ENV === 'development') {
      console.warn(`[API Fetch] Response tidak OK: ${response.status} ${response.statusText} untuk ${url}`);
    }

    // Jika proxy Nginx membalas 502/503/504, berarti Node.js backend offline
    if (response.status === 502 || response.status === 503 || response.status === 504) {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('backend-connection-error'));
      }
      throw new Error('Server Backend Sedang Offline atau Restarting.');
    }

    return response;
  } catch (error: any) {
    // Handle network errors dan abort errors dengan lebih baik
    if (error?.name === 'AbortError') {
      throw error; // Re-throw abort errors untuk di-handle oleh caller
    }

    // Log network errors
    if (error?.message?.includes('Failed to fetch') || error?.message?.includes('NetworkError')) {
      console.error(`[API Fetch] Network error untuk ${url}:`, error.message);

      // Memicu trigger untuk BackendOfflineOverlay jika dieksekusi di ranah Browser
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('backend-connection-error'));
      }

      throw new Error('Gagal terhubung ke server. Pastikan server sedang berjalan dan dapat diakses.');
    }

    throw error;
  }
}

// Export getAuthToken untuk digunakan di komponen lain
export { getAuthToken };

