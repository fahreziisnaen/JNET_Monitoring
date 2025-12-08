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

  // Format sesuai permintaan: "x bulan x hari - x jam : x menit : x detik"
  const dateParts: string[] = [];
  
  // Bagian bulan dan hari
  if (months > 0) {
    dateParts.push(`${months} bulan`);
  }
  if (days > 0) {
    dateParts.push(`${days} hari`);
  }
  
  // Format jam:menit:detik dengan leading zero jika perlu
  const formattedHours = hours.toString().padStart(2, '0');
  const formattedMinutes = minutes.toString().padStart(2, '0');
  const formattedSeconds = seconds.toString().padStart(2, '0');
  
  const timeString = `${formattedHours} jam : ${formattedMinutes} menit : ${formattedSeconds} detik`;
  
  // Jika ada bulan atau hari, tambahkan separator "-"
  if (dateParts.length > 0) {
    return `${dateParts.join(' ')} - ${timeString}`;
  }
  
  // Jika tidak ada bulan atau hari, langsung return waktu saja
  return timeString;
}

