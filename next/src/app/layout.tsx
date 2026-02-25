import type { Metadata } from "next";
import React from "react";
import { Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { AuthProvider } from "@/components/providers/auth-provider";
import { MikrotikProvider } from "@/components/providers/mikrotik-provider";
import { NotificationProvider } from "@/components/providers/notification-provider";
import { BackendOfflineOverlay } from "@/components/ui/backend-offline-overlay";
import { Toaster } from "sonner";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: {
    template: '%s | JNET Monitoring',
    default: 'JNET Monitoring',
  },
  description: "Mikrotik Monitoring Tools",
  icons: {
    icon: '/favicon.ico?v=2',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode; }) {
  // Global Logger Control - Mendiamkan log di browser production
  if (typeof window !== 'undefined' && process.env.NODE_ENV === 'production') {
    console.log = () => { };
    console.debug = () => { };
    console.info = () => { };
    console.warn = () => { };
  }

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} bg-background text-foreground`}>
        <AuthProvider>
          <ThemeProvider>
            <MikrotikProvider>
              <NotificationProvider>
                {children}
                <BackendOfflineOverlay />
                <Toaster richColors position="top-right" closeButton />
              </NotificationProvider>
            </MikrotikProvider>
          </ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}