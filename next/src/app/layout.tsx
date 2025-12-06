import type { Metadata } from "next";
import React from "react";
import { Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { AuthProvider } from "@/components/providers/auth-provider";
import { MikrotikProvider } from "@/components/providers/mikrotik-provider";
import { NotificationProvider } from "@/components/providers/notification-provider";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "JNET - Dashboard",
  description: "Mikrotik Monitoring Tools",
  icons: {
    icon: '/favicon.ico',
    shortcut: '/favicon.ico',
    apple: '/favicon.ico',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode; }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} bg-background text-foreground`}>
        <AuthProvider>
          <ThemeProvider>
            <MikrotikProvider>
              <NotificationProvider>
              {children}
              </NotificationProvider>
            </MikrotikProvider>
          </ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}