"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "@/components/motion";
import {
  X,
  MapPin,
  Tag,
  Info,
  Edit,
  Trash2,
  Users,
  GitBranch,
  PlusCircle,
  Loader2,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Asset } from "./asset-list";
import { apiFetch } from '@/utils/api';

interface Connection {
  name: string;
  type: "user" | "ODP" | "client";
  totalUsers?: number;
  activeUsers?: number;
}

interface AssetDetailModalProps {
  isOpen: boolean;
  asset: Asset | null;
  onClose: () => void;
  onEdit: (_asset: Asset) => void;
  onDelete?: (_asset: Asset) => void;
  onAddConnection?: (_asset: Asset) => void;
  onEditPath?: (_asset: Asset) => void;
  nocWorkspaceId?: number;
}

const AssetDetailModal = ({
  isOpen,
  asset,
  onClose,
  onEdit,
  onDelete,
  onAddConnection,
  onEditPath,
}: AssetDetailModalProps) => {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loadingConnections, setLoadingConnections] = useState(true);
  const [showFullImage, setShowFullImage] = useState(false);

  useEffect(() => {
    if (asset && isOpen) {
      setLoadingConnections(true);
      const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
      Promise.all([
        apiFetch(`${apiUrl}/api/assets/${asset.id}/connections`).then(res => res.json()),
        asset.type === 'ODP'
          ? apiFetch(`${apiUrl}/api/clients`).then(res => res.json()).then(clients =>
            clients.filter((c: any) => c.odp_asset_id === asset.id).map((c: any) => ({
              name: c.pppoe_secret_name,
              type: 'client' as const
            }))
          ).catch(() => [])
          : Promise.resolve([])
      ])
        .then(([connections, clientConnections]: [any[], Connection[]]) => {
          // Convert connections dari API menjadi format yang konsisten
          const formattedConnections: Connection[] = (Array.isArray(connections) ? connections : []).map((conn: any) => ({
            name: conn.name,
            type: conn.type || 'user' as const,
            totalUsers: conn.totalUsers,
            activeUsers: conn.activeUsers
          }));

          // Gabungkan connections dan clientConnections
          const allConnections = [...formattedConnections, ...clientConnections];

          // Hapus duplikat berdasarkan name (prioritaskan client jika ada duplikat)
          // Gunakan Map dengan name sebagai key untuk menghapus duplikat
          const connectionMap = new Map<string, Connection>();

          // Tambahkan formattedConnections dulu
          formattedConnections.forEach((conn: Connection) => {
            if (!connectionMap.has(conn.name)) {
              connectionMap.set(conn.name, conn);
            }
          });

          // Tambahkan clientConnections (akan override jika ada duplikat dengan name yang sama)
          clientConnections.forEach((conn: Connection) => {
            connectionMap.set(conn.name, conn);
          });

          // Convert Map kembali ke array
          const uniqueConnections = Array.from(connectionMap.values());

          setConnections(uniqueConnections);
        })
        .catch((err) => console.error("Gagal fetch koneksi:", err))
        .finally(() => setLoadingConnections(false));
    }
  }, [asset, isOpen]);

  if (!asset) return null;

  const lat = parseFloat(asset.latitude as any);
  const lon = parseFloat(asset.longitude as any);
  const connectionLabel =
    asset.type === "ODP" ? "User & Client Terhubung" : "ODP Terhubung";

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            key="modal-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 flex items-center justify-center z-[1001] p-4"
            onClick={onClose}
          >
            <motion.div
              initial={{ y: 50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 50, opacity: 0 }}
              transition={{ type: "spring", damping: 20, stiffness: 300 }}
              className="bg-card text-card-foreground rounded-2xl shadow-2xl w-full max-w-sm border"
              onClick={(e) => e.stopPropagation()}
            >
              <header className="flex justify-between items-center p-4 border-b">
                <h2 className="text-xl font-bold truncate" title={asset.name}>
                  {asset.name}
                </h2>
                <button
                  onClick={onClose}
                  className="p-1 rounded-full hover:bg-secondary"
                >
                  <X size={20} />
                </button>
              </header>
              <div className="p-6 space-y-4">
                <div className="flex items-center gap-3">
                  <Tag size={16} className="text-muted-foreground" />
                  <span className="text-sm">
                    Tipe: <span className="font-semibold">{asset.type}</span>
                  </span>
                </div>
                {asset.owner_name && (
                  <div className="flex items-center gap-3">
                    <User size={16} className="text-muted-foreground" />
                    <span className="text-sm">
                      Pemilik: <span className="font-semibold">{asset.owner_name}</span>
                    </span>
                  </div>
                )}
                {asset.splitter_count && (
                  <div className="flex items-center gap-3">
                    <GitBranch size={16} className="text-muted-foreground" />
                    <span className="text-sm">
                      Splitter:{" "}
                      <span className="font-semibold">
                        1x{asset.splitter_count}
                      </span>
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <MapPin size={16} className="text-muted-foreground" />
                  <span className="text-sm">
                    Koordinat:{" "}
                    <a
                      href={`https://www.google.com/maps?q=${lat},${lon}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-xs text-primary hover:underline"
                    >
                      {`${lat.toFixed(5)}, ${lon.toFixed(5)}`}
                    </a>
                  </span>
                </div>
                <div className="flex items-start gap-3">
                  <Info size={16} className="text-muted-foreground mt-0.5" />
                  <p className="text-sm italic text-muted-foreground">
                    {asset.description || "Tidak ada deskripsi."}
                  </p>
                </div>

                {asset.photo_url && (
                  <div className="pt-2">
                    <div
                      className="relative w-full aspect-video rounded-lg overflow-hidden border bg-muted cursor-zoom-in hover:opacity-90 transition-opacity"
                      onClick={() => setShowFullImage(true)}
                    >
                      <img
                        src={`${process.env.NEXT_PUBLIC_API_BASE_URL}${asset.photo_url}`}
                        alt={asset.name}
                        className="object-cover w-full h-full"
                      />
                    </div>
                  </div>
                )}

                <div className="pt-4 border-t">
                  <div className="flex justify-between items-center mb-2">
                    <h3 className="text-sm font-semibold flex items-center gap-2">
                      <Users size={16} /> {asset.type === 'ODC' ? `Total ODP: ${connections.length}` : `${connectionLabel} (${connections.length})`}
                    </h3>
                    {asset.type === 'ODC' && connections.length > 0 && (
                      <span className="text-xs font-semibold text-primary">
                        Total Client: {connections.reduce((sum, c) => sum + (c.activeUsers || 0), 0)}/{connections.reduce((sum, c) => sum + (c.totalUsers || 0), 0)}
                      </span>
                    )}
                  </div>
                  <div className="max-h-28 overflow-y-auto space-y-1 pr-2 scrollbar-thin scrollbar-thumb-muted-foreground/20">
                    {loadingConnections ? (
                      <Loader2 className="animate-spin" />
                    ) : connections.length > 0 ? (
                      connections.map((conn, index) => (
                        <div
                          key={`${conn.type}-${conn.name}-${index}`}
                          className="text-xs bg-secondary p-2 rounded-md flex justify-between items-center"
                        >
                          <span className="truncate">{conn.name}</span>
                          {conn.type === 'ODP' && conn.totalUsers !== undefined && (
                            <span className={conn.activeUsers === 0 && conn.totalUsers > 0 ? "text-red-500 font-medium whitespace-nowrap" : conn.activeUsers === conn.totalUsers && conn.totalUsers > 0 ? "text-green-500 font-medium whitespace-nowrap" : conn.activeUsers && conn.activeUsers > 0 ? "text-amber-500 font-medium whitespace-nowrap" : "text-muted-foreground font-medium whitespace-nowrap"}>
                              ({conn.activeUsers || 0}/{conn.totalUsers} clients)
                            </span>
                          )}
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Tidak ada koneksi.
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <footer className="flex justify-between items-center p-4 bg-secondary/50 rounded-b-2xl">
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onEdit(asset)}
                    title="Edit Aset"
                  >
                    <Edit size={16} />
                  </Button>
                  {onDelete && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onDelete(asset)}
                      className="text-muted-foreground hover:text-destructive"
                      title="Hapus Aset"
                    >
                      <Trash2 size={16} />
                    </Button>
                  )}
                </div>
                {(asset.type === "ODP" && onAddConnection) && (
                  <Button onClick={() => onAddConnection(asset)}>
                    <PlusCircle size={16} className="mr-2" /> Tambah Koneksi
                  </Button>
                )}
              </footer>
            </motion.div>
          </motion.div>

          {/* Full Screen Image Overlay */}
          <AnimatePresence>
            {showFullImage && asset.photo_url && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[1100] bg-black/90 flex items-center justify-center p-4 cursor-zoom-out"
                onClick={() => setShowFullImage(false)}
              >
                <motion.div
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.9, opacity: 0 }}
                  className="relative max-w-5xl max-h-full w-full h-full flex items-center justify-center"
                  onClick={(e) => e.stopPropagation()}
                >
                  <img
                    src={`${process.env.NEXT_PUBLIC_API_BASE_URL}${asset.photo_url}`}
                    alt={asset.name}
                    className="max-w-full max-h-full object-contain shadow-2xl rounded-lg"
                  />
                  <button
                    onClick={() => setShowFullImage(false)}
                    className="absolute top-2 right-2 p-2 bg-black/50 hover:bg-black/80 text-white rounded-full transition-colors"
                  >
                    <X size={24} />
                  </button>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </AnimatePresence>
  );
};
export default AssetDetailModal;
