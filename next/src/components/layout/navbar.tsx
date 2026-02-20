'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Settings, SlidersHorizontal, MapPin, Wifi, ShieldCheck, FileText } from 'lucide-react';

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
    return (
        <nav className="fixed bottom-4 sm:bottom-6 inset-x-0 flex justify-center z-50 px-2 sm:px-0">
            <div className="flex items-center gap-x-3 sm:gap-x-6 md:gap-x-8 px-4 sm:px-6 md:px-8 py-2 sm:py-3 bg-card/80 backdrop-blur-md rounded-full shadow-lg border">
                {navItems.map((item) => {
                    const isActive = pathname === item.href;
                    const Icon = item.icon;
                    return (
                        <Link
                            key={item.label}
                            href={item.href}
                            className={`group flex flex-col items-center transition-colors duration-300 ${isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                                }`}
                        >
                            <div className="transition-transform duration-300 group-hover:-translate-y-1"><Icon className="h-5 w-5 sm:h-6 sm:w-6" /></div>
                            <span className="absolute -bottom-5 text-xs opacity-0 group-hover:opacity-100 transition-opacity duration-300 hidden sm:block">{item.label}</span>
                        </Link>
                    )
                })}
            </div>
        </nav>
    )
}
export default Navbar;