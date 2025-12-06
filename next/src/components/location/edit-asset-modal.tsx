"use client";

import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "@/components/motion";
import { X, Edit, Loader2, ChevronDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Asset } from "./asset-list";
import { apiFetch } from '@/utils/api';

interface EditAssetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  assetToEdit: Asset | null;
}

const EditAssetModal = ({
  isOpen,
  onClose,
  onSuccess,
  assetToEdit,
}: EditAssetModalProps) => {
  const [formData, setFormData] = useState({
    name: "",
    type: "ODP",
    splitterCount: "",
    coords: "",
    description: "",
    parentAssetId: "",
    connectionStatus: "terpasang",
    ownerName: "",
  });
  const [availableParents, setAvailableParents] = useState<Asset[]>([]);
  const [assetOwners, setAssetOwners] = useState<{ id: number; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [parentSearchQuery, setParentSearchQuery] = useState("");
  const [isParentDropdownOpen, setIsParentDropdownOpen] = useState(false);
  const [ownerInputMode, setOwnerInputMode] = useState<'dropdown' | 'manual'>('dropdown');
  const [ownerSearchQuery, setOwnerSearchQuery] = useState("");
  const [isOwnerDropdownOpen, setIsOwnerDropdownOpen] = useState(false);
  const parentDropdownRef = useRef<HTMLDivElement>(null);
  const ownerDropdownRef = useRef<HTMLDivElement>(null);


  useEffect(() => {
    if (assetToEdit) {
      setFormData({
        name: assetToEdit.name,
        type: assetToEdit.type,
        splitterCount: String(assetToEdit.splitter_count || ""),
        coords: `${assetToEdit.latitude}, ${assetToEdit.longitude}`,
        description: assetToEdit.description || "",
        parentAssetId: String(assetToEdit.parent_asset_id || ""),
        connectionStatus: assetToEdit.connection_status || "terpasang",
        ownerName: assetToEdit.owner_name || "",
      });
      
      // Set initial search query if parent exists
      if (assetToEdit.parent_asset_id) {
        // Will be set after parents are loaded
        setParentSearchQuery("");
      } else {
        setParentSearchQuery("");
      }
      
      // Load available parent assets
      loadAvailableParents(assetToEdit.type, assetToEdit.id);
      // Load asset owners
      loadAssetOwners();
      // Set owner search query jika ada owner_name
      if (assetToEdit.owner_name) {
        setOwnerSearchQuery(assetToEdit.owner_name);
        setFormData((prev) => ({ ...prev, ownerName: assetToEdit.owner_name || "" }));
      }
    }
  }, [assetToEdit]);

  // Cek apakah owner yang dipilih ada di daftar setelah owners dimuat
  useEffect(() => {
    if (assetToEdit?.owner_name && assetOwners.length > 0) {
      const ownerExists = assetOwners.some(owner => owner.name === assetToEdit.owner_name);
      if (!ownerExists && assetToEdit.owner_name) {
        setOwnerInputMode('manual');
      } else {
        setOwnerInputMode('dropdown');
      }
    }
  }, [assetOwners, assetToEdit]);

  // Update search query when parent is selected or parents are loaded
  useEffect(() => {
    if (formData.parentAssetId && availableParents.length > 0) {
      const selected = availableParents.find((p) => String(p.id) === formData.parentAssetId);
      if (selected) {
        const expectedQuery = `${selected.name} (${selected.type})`;
        if (parentSearchQuery !== expectedQuery) {
          setParentSearchQuery(expectedQuery);
        }
      }
    } else if (!formData.parentAssetId && parentSearchQuery) {
      setParentSearchQuery("");
    }
  }, [formData.parentAssetId, availableParents]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (parentDropdownRef.current && !parentDropdownRef.current.contains(event.target as Node)) {
        setIsParentDropdownOpen(false);
      }
      if (ownerDropdownRef.current && !ownerDropdownRef.current.contains(event.target as Node)) {
        setIsOwnerDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const loadAssetOwners = async () => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
      const res = await apiFetch(`${apiUrl}/api/assets/owners`);
      if (res.ok) {
        const owners = await res.json();
        console.log('[Edit Asset Modal] Asset owners loaded:', owners);
        setAssetOwners(owners);
      } else {
        const errorData = await res.json().catch(() => ({}));
        console.error('[Edit Asset Modal] Failed to load asset owners:', res.status, errorData);
      }
    } catch (err) {
      console.error('[Edit Asset Modal] Gagal memuat daftar pemilik asset:', err);
    }
  };

  const loadAvailableParents = async (assetType: string, currentAssetId: number) => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
      const res = await apiFetch(`${apiUrl}/api/assets`);
      if (!res.ok) return;
      
      const allAssets: Asset[] = await res.json();
      
      // Filter berdasarkan hierarchy baru: Mikrotik -> OLT -> ODC -> ODP (ODP bisa parent dari ODP juga)
      let parentTypes: string[] = [];
      if (assetType === 'ODP') {
        parentTypes = ['ODC', 'ODP'];
      } else if (assetType === 'ODC') {
        parentTypes = ['OLT'];
      } else if (assetType === 'OLT') {
        parentTypes = ['Mikrotik'];
      }
      // Mikrotik tidak punya parent
      
      const parents = allAssets.filter(
        asset => parentTypes.includes(asset.type) && asset.id !== currentAssetId
      );
      
      setAvailableParents(parents);
    } catch (err) {
      console.error('Gagal memuat parent assets:', err);
    }
  };

  const handleChange = (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >
  ) => {
    const newValue = e.target.value;
    setFormData((prev) => {
      const updated = { ...prev, [e.target.name]: newValue };
      
      // Jika type berubah, reset parent dan reload available parents
      if (e.target.name === 'type' && assetToEdit) {
        updated.parentAssetId = '';
        setParentSearchQuery('');
        loadAvailableParents(newValue, assetToEdit.id);
      }
      
      return updated;
    });
  };

  const filteredParents = availableParents.filter((parent) =>
    parent.name.toLowerCase().includes(parentSearchQuery.toLowerCase()) ||
    parent.type.toLowerCase().includes(parentSearchQuery.toLowerCase())
  );

  const selectedParent = availableParents.find(
    (p) => String(p.id) === formData.parentAssetId
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assetToEdit) return;
    setLoading(true);
    setError("");

    // Jika input manual dan ada owner_name, tambahkan ke database dulu jika belum ada
    if (ownerInputMode === 'manual' && formData.ownerName && formData.ownerName.trim()) {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
        const res = await apiFetch(`${apiUrl}/api/assets/owners`, {
          method: 'POST',
          body: JSON.stringify({ name: formData.ownerName.trim() }),
        });
        if (res.ok) {
          // Refresh daftar owners
          await loadAssetOwners();
        }
      } catch (err) {
        console.error('Gagal menambah pemilik asset:', err);
        // Continue anyway, backend akan handle
      }
    }

    const [latitude, longitude] = formData.coords
      .split(",")
      .map((s) => parseFloat(s.trim()));
    const submissionData = {
      ...formData,
      latitude,
      longitude,
      splitter_count: parseInt(formData.splitterCount) || null,
      parent_asset_id: formData.parentAssetId ? parseInt(formData.parentAssetId) : null,
      connection_status: formData.connectionStatus,
      owner_name: formData.ownerName || null,
    };

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
      const res = await apiFetch(`${apiUrl}/api/assets/${assetToEdit.id}`, {
        method: "PUT",
        body: JSON.stringify(submissionData),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Gagal mengupdate aset");
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
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
          className="bg-card text-card-foreground rounded-2xl shadow-2xl w-full max-w-lg border"
          onClick={(e) => e.stopPropagation()}
        >
          <form onSubmit={handleSubmit}>
            <header className="flex justify-between items-center p-4 border-b">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <Edit /> Edit Aset: {assetToEdit?.name}
              </h2>
              <button
                type="button"
                onClick={onClose}
                className="p-1 rounded-full hover:bg-secondary"
              >
                <X size={20} />
              </button>
            </header>
            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              <div>
                <label
                  htmlFor="name"
                  className="block text-sm font-medium mb-1 text-muted-foreground"
                >
                  Nama Aset
                </label>
                <input
                  id="name"
                  name="name"
                  type="text"
                  value={formData.name}
                  onChange={handleChange}
                  className="w-full p-2 rounded-md bg-input"
                  required
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="type"
                    className="block text-sm font-medium mb-1"
                  >
                    Tipe Aset
                  </label>
                  <select
                    id="type"
                    name="type"
                    value={formData.type}
                    onChange={handleChange}
                    className="w-full p-2 rounded-md bg-input"
                  >
                    <option value="Mikrotik">Mikrotik</option>
                    <option value="OLT">OLT</option>
                    <option value="ODC">ODC</option>
                    <option value="ODP">ODP</option>
                  </select>
                </div>
                {(formData.type === "ODC" || formData.type === "ODP") && (
                  <div>
                    <label
                      htmlFor="splitterCount"
                      className="block text-sm font-medium mb-1"
                    >
                      Jml Splitter
                    </label>
                    <input
                      id="splitterCount"
                      name="splitterCount"
                      type="number"
                      value={formData.splitterCount}
                      onChange={handleChange}
                      className="w-full p-2 rounded-md bg-input"
                    />
                  </div>
                )}
              </div>
              <div>
                <label
                  htmlFor="coords"
                  className="block text-sm font-medium mb-1"
                >
                  Koordinat
                </label>
                <input
                  id="coords"
                  name="coords"
                  type="text"
                  value={formData.coords}
                  onChange={handleChange}
                  className="w-full p-2 rounded-md bg-input"
                  required
                />
              </div>
              <div>
                <label
                  htmlFor="description"
                  className="block text-sm font-medium mb-1"
                >
                  Deskripsi
                </label>
                <textarea
                  id="description"
                  name="description"
                  rows={2}
                  value={formData.description}
                  onChange={handleChange}
                  className="w-full p-2 rounded-md bg-input"
                ></textarea>
              </div>
              <div ref={ownerDropdownRef} className="relative">
                <label
                  htmlFor="ownerName"
                  className="block text-sm font-medium mb-1"
                >
                  Pemilik Asset
                </label>
                <div className="flex gap-2 mb-1">
                  <Button
                    type="button"
                    variant={ownerInputMode === 'dropdown' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => {
                      setOwnerInputMode('dropdown');
                      setFormData((prev) => ({ ...prev, ownerName: "" }));
                      setOwnerSearchQuery("");
                    }}
                  >
                    Pilih dari Daftar
                  </Button>
                  <Button
                    type="button"
                    variant={ownerInputMode === 'manual' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => {
                      setOwnerInputMode('manual');
                      setFormData((prev) => ({ ...prev, ownerName: "" }));
                      setOwnerSearchQuery("");
                      setIsOwnerDropdownOpen(false);
                    }}
                  >
                    Input Manual
                  </Button>
                </div>
                {ownerInputMode === 'dropdown' ? (
                  <div className="relative">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground" size={16} />
                      <input
                        type="text"
                        value={ownerSearchQuery}
                        onChange={(e) => {
                          setOwnerSearchQuery(e.target.value);
                          setIsOwnerDropdownOpen(true);
                          if (!e.target.value) {
                            setFormData((prev) => ({ ...prev, ownerName: "" }));
                          }
                        }}
                        onFocus={() => setIsOwnerDropdownOpen(true)}
                        placeholder="Cari atau pilih pemilik asset..."
                        className="w-full p-2 pl-10 pr-10 rounded-md bg-input border border-input"
                      />
                      <ChevronDown 
                        className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground cursor-pointer"
                        size={16}
                        onClick={() => setIsOwnerDropdownOpen(!isOwnerDropdownOpen)}
                      />
                    </div>
                    {isOwnerDropdownOpen && (
                      <div className="absolute z-50 w-full mt-1 bg-card border border-input rounded-md shadow-lg max-h-60 overflow-y-auto">
                        {assetOwners.length === 0 ? (
                          <div className="p-2 text-muted-foreground text-sm">
                            Tidak ada pemilik asset. Gunakan mode Input Manual untuk menambahkan.
                          </div>
                        ) : (
                          <>
                            {assetOwners
                              .filter((owner) =>
                                owner.name.toLowerCase().includes(ownerSearchQuery.toLowerCase())
                              )
                              .map((owner) => (
                                <div
                                  key={owner.id}
                                  className="p-2 hover:bg-secondary cursor-pointer"
                                  onClick={() => {
                                    setFormData((prev) => ({ ...prev, ownerName: owner.name }));
                                    setOwnerSearchQuery(owner.name);
                                    setIsOwnerDropdownOpen(false);
                                  }}
                                >
                                  {owner.name}
                                </div>
                              ))}
                            {assetOwners.filter((owner) =>
                              owner.name.toLowerCase().includes(ownerSearchQuery.toLowerCase())
                            ).length === 0 && ownerSearchQuery && (
                              <div className="p-2 text-muted-foreground text-sm">
                                Tidak ada pemilik ditemukan untuk "{ownerSearchQuery}"
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <input
                    id="ownerName"
                    name="ownerName"
                    type="text"
                    value={formData.ownerName}
                    onChange={handleChange}
                    placeholder="Masukkan nama pemilik asset"
                    className="w-full p-2 rounded-md bg-input"
                  />
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  {ownerInputMode === 'dropdown' 
                    ? 'Pilih pemilik asset dari daftar atau cari'
                    : 'Masukkan nama pemilik asset baru (akan tersimpan ke database)'}
                </p>
              </div>
              {(formData.type === "ODC" || formData.type === "ODP" || formData.type === "OLT") && (
                <div ref={parentDropdownRef} className="relative">
                  <label
                    htmlFor="parentAssetId"
                    className="block text-sm font-medium mb-1"
                  >
                    Parent Asset {formData.type === "ODP" ? "(ODC/ODP)" : formData.type === "ODC" ? "(OLT)" : "(Mikrotik)"}
                  </label>
                  <div className="relative">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground" size={16} />
                      <input
                        type="text"
                        value={parentSearchQuery}
                        onChange={(e) => {
                          setParentSearchQuery(e.target.value);
                          setIsParentDropdownOpen(true);
                          if (!e.target.value) {
                            setFormData((prev) => ({ ...prev, parentAssetId: "" }));
                          }
                        }}
                        onFocus={() => setIsParentDropdownOpen(true)}
                        placeholder={selectedParent ? `${selectedParent.name} (${selectedParent.type})` : "Cari parent asset..."}
                        className="w-full p-2 pl-10 pr-10 rounded-md bg-input border border-input"
                      />
                      <ChevronDown 
                        className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground cursor-pointer"
                        size={16}
                        onClick={() => setIsParentDropdownOpen(!isParentDropdownOpen)}
                      />
                    </div>
                    {isParentDropdownOpen && (
                      <div className="absolute z-50 w-full mt-1 bg-card border border-border rounded-md shadow-lg max-h-60 overflow-y-auto">
                        <div
                          className="px-3 py-2 cursor-pointer hover:bg-secondary text-sm"
                          onClick={() => {
                            setFormData((prev) => ({ ...prev, parentAssetId: "" }));
                            setParentSearchQuery("");
                            setIsParentDropdownOpen(false);
                          }}
                        >
                          <span className="text-muted-foreground">Tidak ada parent</span>
                        </div>
                        {filteredParents.length > 0 ? (
                          filteredParents.map((parent) => (
                            <div
                              key={parent.id}
                              className={`px-3 py-2 cursor-pointer hover:bg-secondary text-sm ${
                                String(parent.id) === formData.parentAssetId ? "bg-secondary" : ""
                              }`}
                              onClick={() => {
                                setFormData((prev) => ({ ...prev, parentAssetId: String(parent.id) }));
                                setParentSearchQuery(parent.name);
                                setIsParentDropdownOpen(false);
                              }}
                            >
                              <span className="font-medium">{parent.name}</span>{" "}
                              <span className="text-muted-foreground">({parent.type})</span>
                            </div>
                          ))
                        ) : (
                          <div className="px-3 py-2 text-sm text-muted-foreground">
                            Tidak ada asset yang ditemukan
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {formData.type === "ODP" 
                      ? "Pilih ODC atau ODP sebagai parent untuk membuat garis koneksi"
                      : formData.type === "ODC"
                        ? "Pilih OLT sebagai parent untuk membuat garis koneksi ke ODC"
                        : "Pilih Mikrotik sebagai parent untuk membuat garis koneksi ke OLT"}
                  </p>
                </div>
              )}
              {(formData.type === "ODC" || formData.type === "ODP" || formData.type === "OLT") && formData.parentAssetId && (
                <div>
                  <label
                    htmlFor="connectionStatus"
                    className="block text-sm font-medium mb-1"
                  >
                    Status Koneksi
                  </label>
                  <select
                    id="connectionStatus"
                    name="connectionStatus"
                    value={formData.connectionStatus}
                    onChange={handleChange}
                    className="w-full p-2 rounded-md bg-input"
                  >
                    <option value="terpasang">Terpasang</option>
                    <option value="rencana">Rencana</option>
                    <option value="maintenance">Maintenance</option>
                    <option value="putus">Putus</option>
                  </select>
                  <p className="text-xs text-muted-foreground mt-1">
                    Status koneksi akan menentukan warna garis di peta
                  </p>
                </div>
              )}
              {error && (
                <p className="text-sm text-center text-destructive">{error}</p>
              )}
            </div>
            <footer className="flex justify-end gap-4 p-4 bg-secondary/50">
              <Button type="button" variant="ghost" onClick={onClose}>
                Batal
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? (
                  <Loader2 className="animate-spin h-4 w-4 mr-2" />
                ) : null}{" "}
                Simpan Perubahan
              </Button>
            </footer>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
export default EditAssetModal;
