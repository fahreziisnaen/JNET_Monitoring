export function parseUptimeToSeconds(uptimeStr: string | null | undefined): number {
  if (!uptimeStr || uptimeStr === 'N/A' || uptimeStr === '...') return 0;
  
  const weekMatch = uptimeStr.match(/(\d+)w/);
  const dayMatch = uptimeStr.match(/(\d+)d/);
  const hourMatch = uptimeStr.match(/(\d+)h/);
  const minuteMatch = uptimeStr.match(/(\d+)m/);
  const secondMatch = uptimeStr.match(/(\d+)s/);

  return (
    (weekMatch ? parseInt(weekMatch[1]) : 0) * 7 * 24 * 60 * 60 +
    (dayMatch ? parseInt(dayMatch[1]) : 0) * 24 * 60 * 60 +
    (hourMatch ? parseInt(hourMatch[1]) : 0) * 60 * 60 +
    (minuteMatch ? parseInt(minuteMatch[1]) : 0) * 60 +
    (secondMatch ? parseInt(secondMatch[1]) : 0)
  );
}

export function formatSecondsToUptime(totalSeconds: number): string {
  if (totalSeconds <= 0) return 'N/A';

  const months = Math.floor(totalSeconds / (30 * 24 * 60 * 60));
  const remainingAfterMonths = totalSeconds % (30 * 24 * 60 * 60);

  const days = Math.floor(remainingAfterMonths / (24 * 60 * 60));
  const remainingAfterDays = remainingAfterMonths % (24 * 60 * 60);

  const hours = Math.floor(remainingAfterDays / (60 * 60));
  const remainingAfterHours = remainingAfterDays % (60 * 60);

  const minutes = Math.floor(remainingAfterHours / 60);
  const seconds = remainingAfterHours % 60;

  const partsArray: string[] = [];

  if (months > 0) partsArray.push(`${months}bln`);
  if (days > 0) partsArray.push(`${days}h`);
  if (hours > 0) partsArray.push(`${hours}j`);
  if (minutes > 0) partsArray.push(`${minutes}m`);
  if (seconds > 0 || partsArray.length === 0) partsArray.push(`${seconds}d`);

  return partsArray.join(':');
}

/**
 * Format uptime dari format MikroTik (contoh: "1w2d3h4m5s") 
 * menjadi format "x bulan x hari - x jam : x menit : x detik"
 */
export function formatUptime(uptimeStr: string | null | undefined): string {
  if (!uptimeStr || uptimeStr === 'N/A' || uptimeStr === '...') {
    return 'N/A';
  }
  const totalSeconds = parseUptimeToSeconds(uptimeStr);
  return formatSecondsToUptime(totalSeconds);
}

/**
 * Format string uptime Mikrotik ("1w2d3h4m5s") menjadi sangat ringkas ("1w2d", "5h4m")
 * Berguna untuk tampilan mobile yang sempit
 */
export function formatCompactUptime(uptimeStr: string | null | undefined): string {
  if (!uptimeStr || uptimeStr === 'N/A' || uptimeStr === '...') return '-';

  const weekMatch = uptimeStr.match(/(\d+)w/);
  const dayMatch = uptimeStr.match(/(\d+)d/);
  const hourMatch = uptimeStr.match(/(\d+)h/);
  const minuteMatch = uptimeStr.match(/(\d+)m/);
  const secondMatch = uptimeStr.match(/(\d+)s/);

  const parts = [];
  const w = weekMatch ? weekMatch[1] : null;
  const d = dayMatch ? dayMatch[1] : null;
  const h = hourMatch ? hourMatch[1] : null;
  const m = minuteMatch ? minuteMatch[1] : null;
  const s = secondMatch ? secondMatch[1] : null;

  if (w) parts.push(`${w}w`);
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);

  if (s || parts.length === 0) parts.push(`${s || 0}s`);

  return parts.join(' ');
}

