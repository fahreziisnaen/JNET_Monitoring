'use client';

import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export function useDebouncedValue<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export function SearchBox({ value, onChange, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="relative flex-1 max-w-sm">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <Input className="pl-9" placeholder={placeholder || 'Cari...'} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export function Pagination({ page, limit, total, onPage, loading }: {
  page: number;
  limit: number;
  total: number;
  onPage: (p: number) => void;
  loading?: boolean;
}) {
  const totalPages = Math.max(Math.ceil(total / limit), 1);
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-4 text-sm">
      <span className="text-muted-foreground">
        {total === 0 ? 'Tidak ada data' : `Menampilkan ${from}–${to} dari ${total}`}
      </span>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={loading || page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft size={16} /> Sebelumnya
        </Button>
        <span className="text-muted-foreground px-1">Hal {page} / {totalPages}</span>
        <Button variant="outline" size="sm" disabled={loading || page >= totalPages} onClick={() => onPage(page + 1)}>
          Berikutnya <ChevronRight size={16} />
        </Button>
      </div>
    </div>
  );
}
