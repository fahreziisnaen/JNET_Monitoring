/**
 * Format uptime dari format MikroTik (contoh: "1w2d3h4m5s") 
 * menjadi format "x bulan x hari - x jam : x menit : x detik"
 */
export function formatUptime(uptimeStr: string | null | undefined): string {
  if (!uptimeStr || uptimeStr === 'N/A' || uptimeStr === '...') {
    return 'N/A';
  }

  // Parse uptime string dari MikroTik (format: "1w2d3h4m5s")
  const parts: { [key: string]: number } = {};

  // Match patterns: w (week), d (day), h (hour), m (minute), s (second)
  const weekMatch = uptimeStr.match(/(\d+)w/);
  const dayMatch = uptimeStr.match(/(\d+)d/);
  const hourMatch = uptimeStr.match(/(\d+)h/);
  const minuteMatch = uptimeStr.match(/(\d+)m/);
  const secondMatch = uptimeStr.match(/(\d+)s/);

  if (weekMatch) parts.weeks = parseInt(weekMatch[1]);
  if (dayMatch) parts.days = parseInt(dayMatch[1]);
  if (hourMatch) parts.hours = parseInt(hourMatch[1]);
  if (minuteMatch) parts.minutes = parseInt(minuteMatch[1]);
  if (secondMatch) parts.seconds = parseInt(secondMatch[1]);

  // Convert semua ke detik untuk perhitungan
  const totalSeconds =
    (parts.weeks || 0) * 7 * 24 * 60 * 60 +
    (parts.days || 0) * 24 * 60 * 60 +
    (parts.hours || 0) * 60 * 60 +
    (parts.minutes || 0) * 60 +
    (parts.seconds || 0);

  // Calculate bulan, hari, jam, menit, detik
  // Asumsi 1 bulan = 30 hari untuk perhitungan
  const months = Math.floor(totalSeconds / (30 * 24 * 60 * 60));
  const remainingAfterMonths = totalSeconds % (30 * 24 * 60 * 60);

  const days = Math.floor(remainingAfterMonths / (24 * 60 * 60));
  const remainingAfterDays = remainingAfterMonths % (24 * 60 * 60);

  const hours = Math.floor(remainingAfterDays / (60 * 60));
  const remainingAfterHours = remainingAfterDays % (60 * 60);

  const minutes = Math.floor(remainingAfterHours / 60);
  const seconds = remainingAfterHours % 60;

  // Format sesuai permintaan: "xh - xj - xm - xd"
  const partsArray: string[] = [];

  if (months > 0) partsArray.push(`${months}bln`);
  if (days > 0) partsArray.push(`${days}h`);
  if (hours > 0) partsArray.push(`${hours}j`);
  if (minutes > 0) partsArray.push(`${minutes}m`);
  if (seconds > 0 || partsArray.length === 0) partsArray.push(`${seconds}d`);

  return partsArray.join(' - ');
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

