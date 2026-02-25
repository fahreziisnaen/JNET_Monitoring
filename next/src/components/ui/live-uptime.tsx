'use client';

import React, { useState, useEffect, useRef } from 'react';
import { formatUptime, formatCompactUptime } from '@/utils/format';

/**
 * Parse MikroTik uptime string (e.g. "1w2d3h4m5s") to total seconds.
 */
function parseUptimeToSeconds(uptimeStr: string): number {
    const weekMatch = uptimeStr.match(/(\d+)w/);
    const dayMatch = uptimeStr.match(/(\d+)d/);
    const hourMatch = uptimeStr.match(/(\d+)h/);
    const minuteMatch = uptimeStr.match(/(\d+)m/);
    const secondMatch = uptimeStr.match(/(\d+)s/);

    return (
        (weekMatch ? parseInt(weekMatch[1]) * 7 * 24 * 3600 : 0) +
        (dayMatch ? parseInt(dayMatch[1]) * 24 * 3600 : 0) +
        (hourMatch ? parseInt(hourMatch[1]) * 3600 : 0) +
        (minuteMatch ? parseInt(minuteMatch[1]) * 60 : 0) +
        (secondMatch ? parseInt(secondMatch[1]) : 0)
    );
}

/**
 * Convert total seconds back to MikroTik-style uptime string for formatUptime.
 */
function secondsToUptimeStr(totalSeconds: number): string {
    const weeks = Math.floor(totalSeconds / (7 * 24 * 3600));
    totalSeconds %= 7 * 24 * 3600;
    const days = Math.floor(totalSeconds / (24 * 3600));
    totalSeconds %= 24 * 3600;
    const hours = Math.floor(totalSeconds / 3600);
    totalSeconds %= 3600;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    let str = '';
    if (weeks > 0) str += `${weeks}w`;
    if (days > 0) str += `${days}d`;
    if (hours > 0) str += `${hours}h`;
    if (minutes > 0) str += `${minutes}m`;
    str += `${seconds}s`;
    return str;
}

interface LiveUptimeProps {
    uptime: string | undefined | null;
    compact?: boolean;
}

/**
 * Displays uptime that ticks every second client-side.
 * Re-syncs whenever the uptime prop changes (e.g. after a server poll).
 */
const LiveUptime: React.FC<LiveUptimeProps> = ({ uptime, compact = false }) => {
    const [seconds, setSeconds] = useState<number | null>(null);
    const baseRef = useRef<number>(0);

    // When uptime string changes (re-synced from server), reset the base
    useEffect(() => {
        if (!uptime) {
            setSeconds(null);
            return;
        }
        const parsed = parseUptimeToSeconds(uptime);
        baseRef.current = parsed;
        setSeconds(parsed);
    }, [uptime]);

    // Tick every second
    useEffect(() => {
        if (seconds === null) return;
        const interval = setInterval(() => {
            baseRef.current += 1;
            setSeconds(baseRef.current);
        }, 1000);
        return () => clearInterval(interval);
    }, [seconds === null]); // only re-run when seconds goes null→non-null

    if (seconds === null) return <span>-</span>;

    const str = secondsToUptimeStr(seconds);
    return <span>{compact ? formatCompactUptime(str) : formatUptime(str)}</span>;
};

export default LiveUptime;
