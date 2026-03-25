'use client';

import React, { useState, useEffect, useRef } from 'react';
import { formatUptime, formatCompactUptime } from '@/utils/format';

/**
 * Parse MikroTik uptime string (e.g. "1w2d3h4m5s") to total seconds.
 */
function parseUptimeToSeconds(uptimeStr: string): number {
    return 0; // Not needed anymore since we don't tick
}

function secondsToUptimeStr(totalSeconds: number): string {
    return '0s'; // Not needed
}

interface LiveUptimeProps {
    uptime: string | undefined | null;
    compact?: boolean;
}

const LiveUptime: React.FC<LiveUptimeProps> = ({ uptime, compact = false }) => {
    if (!uptime || uptime === '-' || uptime === 'N/A') return <span>-</span>;
    return <span>{compact ? formatCompactUptime(uptime) : formatUptime(uptime)}</span>;
};

export default LiveUptime;
