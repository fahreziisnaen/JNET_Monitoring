'use client';

import React, { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { motion, AnimatePresence } from '@/components/motion';
import ProfileCard from '@/components/settings/profile-card';
import SecurityCard from '@/components/settings/security-card';
import TwoFactorCard from '@/components/settings/two-factor-card';
import DangerZoneCard from '@/components/settings/danger-zone-card';
import DeviceManagementCard from '@/components/settings/device-management-card';
import ActiveSessionsCard from '@/components/settings/active-sessions-card';
import WhatsappBotCard from '@/components/settings/whatsapp-bot-card';
import JoinWorkspaceCard from '@/components/settings/join-workspace-card';
import WorkspaceMembersCard from '@/components/settings/workspace-members-card';
import NocAccessCard from '@/components/settings/noc-access-card';
import BackupRestoreCard from '@/components/settings/backup-restore-card';
import ApiKeyManagementCard from '@/components/settings/api-key-management-card';
import { usePageTitle } from '@/hooks/usePageTitle';

interface CollapsibleSectionProps {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

const CollapsibleSection = ({ title, isOpen, onToggle, children }: CollapsibleSectionProps) => {
  return (
    <section className="space-y-6">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between text-xl font-semibold text-primary border-b pb-2 hover:opacity-80 transition-opacity"
      >
        <span>{title}</span>
        {isOpen ? <ChevronUp className="w-6 h-6" /> : <ChevronDown className="w-6 h-6" />}
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="overflow-hidden space-y-6 pt-2"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
};

const SettingsPage = () => {
  usePageTitle('Pengaturan');
  
  const [openSections, setOpenSections] = useState({
    profile: true,
    connectivity: true,
    workspace: true,
    bot: true,
    security: true
  });

  useEffect(() => {
    // Jika mobile (lebar < 768px), minimize semua kecuali profile
    if (window.innerWidth < 768) {
      setOpenSections({
        profile: true,
        connectivity: false,
        workspace: false,
        bot: false,
        security: false
      });
    }
  }, []);

  const toggleSection = (section: keyof typeof openSections) => {
    setOpenSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-12">
      <header>
        <h1 className="text-3xl font-bold">Pengaturan</h1>
        <p className="text-muted-foreground">
          Kelola profil, keamanan, dan preferensi akun Anda di sini.
        </p>
      </header>

      <CollapsibleSection 
        title="Akun & Profil" 
        isOpen={openSections.profile} 
        onToggle={() => toggleSection('profile')}
      >
        <ProfileCard />
        <SecurityCard />
        <TwoFactorCard />
      </CollapsibleSection>

      <CollapsibleSection 
        title="Perangkat & Konektivitas" 
        isOpen={openSections.connectivity} 
        onToggle={() => toggleSection('connectivity')}
      >
        <DeviceManagementCard />
      </CollapsibleSection>

      <CollapsibleSection 
        title="Manajemen Workspace & Pengguna" 
        isOpen={openSections.workspace} 
        onToggle={() => toggleSection('workspace')}
      >
        <JoinWorkspaceCard />
        <WorkspaceMembersCard />
        <NocAccessCard />
      </CollapsibleSection>

      <CollapsibleSection 
        title="Integrasi & Layanan Eksternal"
        isOpen={openSections.bot} 
        onToggle={() => toggleSection('bot')}
      >
        <WhatsappBotCard />
        <ApiKeyManagementCard />
      </CollapsibleSection>

      <CollapsibleSection 
        title="Keamanan Lanjutan" 
        isOpen={openSections.security} 
        onToggle={() => toggleSection('security')}
      >
        <BackupRestoreCard />
        <ActiveSessionsCard />
        <DangerZoneCard />
      </CollapsibleSection>
    </div>
  );
};

export default SettingsPage;