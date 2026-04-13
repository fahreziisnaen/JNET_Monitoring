'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Settings, SlidersHorizontal, MapPin, Wifi, ShieldCheck, FileText, X, Menu } from 'lucide-react';
import { useAuth } from '@/components/providers/auth-provider';
import { useState, useEffect, useCallback } from 'react';

const NocIcon = ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <rect x="16" y="16" width="6" height="6" rx="1" />
        <rect x="2" y="16" width="6" height="6" rx="1" />
        <rect x="9" y="2" width="6" height="6" rx="1" />
        <path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1-1v3" />
        <path d="M12 12V8" />
    </svg>
);

const navItems = [
    { icon: Home, label: 'Dashboard', href: '/dashboard' },
    { icon: SlidersHorizontal, label: 'Management', href: '/management' },
    { icon: MapPin, label: 'Location', href: '/location' },
    { icon: Wifi, label: 'Hotspot', href: '/hotspot' },
    { icon: ShieldCheck, label: 'SLA', href: '/sla' },
    { icon: FileText, label: 'Report', href: '/report' },
    { icon: Settings, label: 'Settings', href: '/settings' },
];

const Navbar = () => {
    const pathname = usePathname();
    const { user } = useAuth();
    const isNoc = user?.role === 'noc';
    const showNoc = user?.is_super_admin || isNoc || user?.role === 'admin';
    const [isOpen, setIsOpen] = useState(false);

    // Lock body scroll when FAB menu is open
    useEffect(() => {
        if (isOpen) {
            const scrollY = window.scrollY;
            document.body.style.position = 'fixed';
            document.body.style.top = `-${scrollY}px`;
            document.body.style.width = '100%';
            document.body.style.overflowY = 'scroll';
        } else {
            const scrollY = document.body.style.top;
            document.body.style.position = '';
            document.body.style.top = '';
            document.body.style.width = '';
            document.body.style.overflowY = '';
            if (scrollY) {
                window.scrollTo(0, parseInt(scrollY || '0') * -1);
            }
        }
        return () => {
            document.body.style.position = '';
            document.body.style.top = '';
            document.body.style.width = '';
            document.body.style.overflowY = '';
        };
    }, [isOpen]);

    // Close FAB when route changes
    useEffect(() => {
        setIsOpen(false);
    }, [pathname]);

    const close = useCallback(() => setIsOpen(false), []);

    const filteredNavItems = navItems.filter(item => {
        if (isNoc) return ['Dashboard', 'Settings'].includes(item.label);
        return true;
    });

    const allItems = [
        ...filteredNavItems,
        ...(showNoc ? [{ icon: NocIcon as any, label: 'NOC', href: '/noc' }] : []),
    ];

    return (
        <>
            {/* Backdrop — intercepts all touch/click events behind FAB */}
            {isOpen && (
                <div
                    className="sm:hidden fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]"
                    onClick={close}
                    onTouchStart={(e) => { e.preventDefault(); close(); }}
                />
            )}

            {/* Mobile FAB speed dial */}
            <div
                className="sm:hidden fixed bottom-6 right-5 z-50 flex flex-col items-end gap-3"
                style={{ willChange: 'transform', transform: 'translateZ(0)' }}
            >
                {/* Menu items — shown when open */}
                <div
                    className={`flex flex-col items-end gap-2 transition-all duration-200 ${
                        isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none h-0 overflow-hidden'
                    }`}
                >
                    {allItems.map((item, i) => {
                        const isActive = pathname === item.href;
                        const Icon = item.icon;
                        return (
                            <Link
                                key={item.label}
                                href={item.href}
                                className="flex items-center gap-3"
                                style={{ transitionDelay: isOpen ? `${i * 30}ms` : '0ms' }}
                                onClick={close}
                            >
                                {/* Label pill */}
                                <span className={`px-3 py-1.5 rounded-full text-sm font-medium shadow-md border transition-colors ${
                                    isActive
                                        ? 'bg-primary text-primary-foreground border-primary'
                                        : 'bg-card text-foreground border-border'
                                }`}>
                                    {item.label}
                                </span>
                                {/* Icon circle */}
                                <div className={`h-11 w-11 rounded-full flex items-center justify-center shadow-md border transition-colors ${
                                    isActive
                                        ? 'bg-primary text-primary-foreground border-primary'
                                        : 'bg-card text-muted-foreground border-border'
                                }`}>
                                    <Icon className="h-5 w-5" />
                                </div>
                            </Link>
                        );
                    })}
                </div>

                {/* Main FAB button */}
                <button
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); setIsOpen(prev => !prev); }}
                    className="h-14 w-14 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg transition-transform duration-200 active:scale-95 touch-manipulation"
                    aria-label="Toggle menu"
                >
                    {isOpen
                        ? <X className="h-6 w-6" />
                        : <Menu className="h-6 w-6" />
                    }
                </button>
            </div>

            {/* Desktop pill navbar */}
            <nav className="hidden sm:flex fixed bottom-6 inset-x-0 justify-center z-50 pointer-events-none">
                <div className="pointer-events-auto flex items-center gap-x-6 md:gap-x-8 px-6 md:px-8 py-3 bg-card/80 backdrop-blur-md rounded-full shadow-lg border">
                    {allItems.map((item) => {
                        const isActive = pathname === item.href;
                        const Icon = item.icon;
                        return (
                            <Link
                                key={item.label}
                                href={item.href}
                                className={`group flex flex-col items-center transition-colors duration-300 ${
                                    isActive ? 'text-primary' : 'text-slate-500 hover:text-foreground'
                                }`}
                            >
                                <div className="transition-transform duration-300 group-hover:-translate-y-1">
                                    <Icon className="h-6 w-6" />
                                </div>
                                <span className="absolute -bottom-5 text-xs opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                                    {item.label}
                                </span>
                            </Link>
                        );
                    })}
                </div>
            </nav>
        </>
    );
};

export default Navbar;
