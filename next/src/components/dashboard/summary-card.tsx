'use client';

import React from 'react';
import { motion } from '@/components/motion';
import { Card, CardContent } from '@/components/ui/card';

interface SummaryCardProps {
  title: string;
  count: number | string | React.ReactNode;
  icon: React.ReactNode;
  colorClass: string;
}

const SummaryCard = ({ title, count, icon, colorClass }: SummaryCardProps) => {
  return (
    <motion.div whileHover={{ y: -5 }} className="h-full">
      <Card className={`text-white ${colorClass}`}>
        <CardContent className="p-3 sm:p-6 flex justify-between items-start">
          <div className="flex flex-col">
            <p className="text-xs sm:text-lg font-medium text-white/80">{title}</p>
            <div className="text-xl sm:text-4xl font-bold mt-1 sm:mt-0">
              {typeof count === 'object' ? count : <span>{count}</span>}
            </div>
          </div>
          <div className="p-1.5 sm:p-3 bg-black/20 rounded-lg sm:rounded-xl">
            {React.cloneElement(icon as React.ReactElement, { className: 'w-4 h-4 sm:w-7 sm:h-7' } as any)}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
};

export default SummaryCard;