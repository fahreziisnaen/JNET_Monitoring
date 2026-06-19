'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Calendar } from 'lucide-react';
import { format, parse, parseISO, isValid } from 'date-fns';
import { Input } from '@/components/ui/input';

function toDisplay(iso: string): string {
  if (!iso) return '';
  const dt = parseISO(iso);
  return isValid(dt) ? format(dt, 'dd/MM/yyyy') : '';
}

function parseDisplay(s: string): string | null {
  const dt = parse(s, 'dd/MM/yyyy', new Date());
  return isValid(dt) ? format(dt, 'yyyy-MM-dd') : null;
}

function formatTyping(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  const dd = digits.slice(0, 2);
  const mm = digits.slice(2, 4);
  const yy = digits.slice(4, 8);
  if (digits.length >= 5) return `${dd}/${mm}/${yy}`;
  if (digits.length >= 3) return `${dd}/${mm}`;
  return dd;
}

export default function DateField({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (iso: string) => void;
  className?: string;
}) {
  const [text, setText] = useState(() => toDisplay(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(toDisplay(value));
  }, [value]);

  const onText = (raw: string) => {
    const f = formatTyping(raw);
    setText(f);
    if (f === '') { onChange(''); return; }
    const iso = parseDisplay(f);
    if (iso) onChange(iso);
  };

  const onBlur = () => {
    focused.current = false;
    const iso = parseDisplay(text);
    if (iso) { onChange(iso); setText(toDisplay(iso)); }
    else setText(toDisplay(value));
  };

  return (
    <div className={`relative ${className || ''}`}>
      <Input
        value={text}
        onFocusCapture={() => { focused.current = true; }}
        onBlur={onBlur}
        onChange={(e) => onText(e.target.value)}
        placeholder="dd/mm/yyyy"
        inputMode="numeric"
        className="pr-10"
      />
      <Calendar size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
      <input
        type="date"
        value={value || ''}
        onChange={(e) => { onChange(e.target.value); setText(toDisplay(e.target.value)); }}
        className="absolute right-0 top-0 h-full w-10 cursor-pointer opacity-0"
        tabIndex={-1}
        aria-hidden
      />
    </div>
  );
}
