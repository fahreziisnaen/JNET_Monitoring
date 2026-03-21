/**
 * Format uptime dari format MikroTik (contoh: "1w2d3h4m5s") 
 * menjadi format "x bulan x hari - x jam : x menit : x detik"
 */
export function formatUptime(uptimeStr: string | null | undefined): string {
  if (!uptimeStr || uptimeStr === 'N/A' || uptimeStr === '...') {
    return 'N/A';
  }
  return uptimeStr;
}

/**
 * Format string uptime Mikrotik ("1w2d3h4m5s") menjadi sangat ringkas ("1w2d", "5h4m")
 * Berguna untuk tampilan mobile yang sempit
 */
export function formatCompactUptime(uptimeStr: string | null | undefined): string {
  if (!uptimeStr || uptimeStr === 'N/A' || uptimeStr === '...') return '-';
  return uptimeStr;
}

