'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Settings, SlidersHorizontal, MapPin, Wifi, ShieldCheck, FileText } from 'lucide-react';
import { useAuth } from '@/components/providers/auth-provider';

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

    // Role-based filtering of main nav items
    const filteredNavItems = navItems.filter(item => {
        if (isNoc) {
            // NOC only sees Dashboard and Settings
            return ['Dashboard', 'Settings'].includes(item.label);
        }
        return true;
    });

    return (
        <nav className="fixed bottom-4 sm:bottom-6 inset-x-0 flex justify-center z-50 px-2 sm:px-0 pointer-events-none">
            <div className="pointer-events-auto flex items-center gap-x-3 sm:gap-x-6 md:gap-x-8 px-4 sm:px-6 md:px-8 py-2 sm:py-3 bg-card/80 backdrop-blur-md rounded-full shadow-lg border">
                {filteredNavItems.map((item) => {
                    const isActive = pathname === item.href;
                    const Icon = item.icon;
                    return (
                        <Link
                            key={item.label}
                            href={item.href}
                            className={`group flex flex-col items-center transition-colors duration-300 ${isActive ? 'text-primary' : 'text-slate-500 hover:text-foreground'
                                }`}
                        >
                            <div className="transition-transform duration-300 group-hover:-translate-y-1"><Icon className="h-5 w-5 sm:h-6 sm:w-6" /></div>
                            <span className="absolute -bottom-5 text-xs opacity-0 group-hover:opacity-100 transition-opacity duration-300 hidden sm:block">{item.label}</span>
                        </Link>
                    )
                })}
                {((user?.is_super_admin || isNoc || user?.role === 'admin')) && (
                    <Link
                        key="NOC"
                        href="/noc"
                        className={`group flex flex-col items-center transition-colors duration-300 ${pathname === '/noc' ? 'text-primary' : 'text-slate-500 hover:text-foreground'
                            }`}
                    >
                        <div className="transition-transform duration-300 group-hover:-translate-y-1">
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-network h-5 w-5 sm:h-6 sm:w-6"><rect x="16" y="16" width="6" height="6" rx="1" /><rect x="2" y="16" width="6" height="6" rx="1" /><rect x="9" y="2" width="6" height="6" rx="1" /><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1-1v3" /><path d="M12 12V8" /></svg>
                        </div>
                        <span className="absolute -bottom-5 text-xs opacity-0 group-hover:opacity-100 transition-opacity duration-300 hidden sm:block">NOC</span>
                    </Link>
                )}
            </div>
        </nav>
    )
}
export default Navbar;