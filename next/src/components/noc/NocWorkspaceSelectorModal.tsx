"use client";

import React from "react";
import { motion, AnimatePresence } from "@/components/motion";
import { X, Layout, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface NocWorkspaceSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (workspaceId: number) => void;
  workspaces: { id: number, name: string }[];
  title?: string;
  description?: string;
}

import { useEscKey } from '@/hooks/useEscKey';

const NocWorkspaceSelectorModal = ({
  isOpen,
  onClose,
  onSelect,
  workspaces,
  title = "Pilih Workspace",
  description = "Tentukan workspace target untuk aksi ini."
}: NocWorkspaceSelectorModalProps) => {
  useEscKey(isOpen, onClose);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-[1100] p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 20 }}
            className="bg-card text-card-foreground rounded-2xl shadow-2xl w-full max-w-md border border-border overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex justify-between items-center p-5 border-b border-border bg-secondary/30">
              <div>
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <Layout className="text-primary" size={20} /> {title}
                </h2>
                <p className="text-xs text-muted-foreground mt-1">{description}</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-2 rounded-full hover:bg-secondary transition-colors"
              >
                <X size={20} />
              </button>
            </header>

            <div className="p-6 max-h-[60vh] overflow-y-auto">
              <div className="grid gap-3">
                {workspaces.length > 0 ? (
                  workspaces.map((ws: { id: number, name: string }) => (
                    <button
                      key={ws.id}
                      onClick={() => {
                        onSelect(ws.id);
                        onClose();
                      }}
                      className="flex items-center justify-between p-4 rounded-xl border border-border hover:border-primary/50 hover:bg-primary/5 transition-all group text-left"
                    >
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary font-bold group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                          {ws.id}
                        </div>
                        <div>
                          <div className="font-semibold">{ws.name}</div>
                          <div className="text-xs text-muted-foreground">ID Workspace: {ws.id}</div>
                        </div>
                      </div>
                      <ChevronRight size={18} className="text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
                    </button>
                  ))
                ) : (
                  <div className="text-center py-10 text-muted-foreground italic">
                    Tidak ada workspace yang tersedia.
                  </div>
                )}
              </div>
            </div>

            <footer className="p-4 bg-secondary/10 border-t border-border flex justify-end">
              <Button variant="ghost" onClick={onClose}>
                Batal
              </Button>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default NocWorkspaceSelectorModal;
