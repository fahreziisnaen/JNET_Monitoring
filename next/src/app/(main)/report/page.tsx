'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { FileText, Download, Loader2, Calendar, Plus, X, Server, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { apiFetch, getAuthToken } from '@/utils/api';

interface Device {
  id: number;
  name: string;
  host: string;
  user: string;
  port: number;
}


interface DeviceSelection {
  deviceId: number;
  deviceName: string;
  isCollapsed?: boolean;
}

const ReportPage = () => {
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [isGenerating, setIsGenerating] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceSelections, setDeviceSelections] = useState<DeviceSelection[]>([]);
  const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;

  const months = [
    { value: 1, label: 'Januari' },
    { value: 2, label: 'Februari' },
    { value: 3, label: 'Maret' },
    { value: 4, label: 'April' },
    { value: 5, label: 'Mei' },
    { value: 6, label: 'Juni' },
    { value: 7, label: 'Juli' },
    { value: 8, label: 'Agustus' },
    { value: 9, label: 'September' },
    { value: 10, label: 'Oktober' },
    { value: 11, label: 'November' },
    { value: 12, label: 'Desember' },
  ];

  const years = [];
  const currentYear = new Date().getFullYear();
  for (let i = currentYear - 2; i <= currentYear; i++) {
    years.push(i);
  }

  // Load devices on mount
  const loadDevices = useCallback(async () => {
    try {
      const res = await apiFetch(`${apiUrl}/api/devices`);
      if (res.ok) {
        const devicesData = await res.json();
        setDevices(devicesData);
      }
    } catch (error) {
      console.error('Error loading devices:', error);
    }
  }, [apiUrl]);

  useEffect(() => {
    loadDevices();
  }, [loadDevices]);

  const handleAddDevice = () => {
    // Add empty device selection
    setDeviceSelections([...deviceSelections, {
      deviceId: 0,
      deviceName: '',
      isCollapsed: false
    }]);
  };

  const handleRemoveDevice = (index: number) => {
    setDeviceSelections(deviceSelections.filter((_, i) => i !== index));
  };

  const handleDeviceChange = async (index: number, deviceId: number) => {
    const device = devices.find(d => d.id === deviceId);
    if (!device) return;

    const newSelections = [...deviceSelections];
    newSelections[index] = {
      deviceId: deviceId,
      deviceName: device.name,
      isCollapsed: newSelections[index].isCollapsed ?? false
    };
    setDeviceSelections(newSelections);
    
    // Force close any open dropdowns by blurring active element
    if (document.activeElement && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  };

  const handleToggleCollapse = (index: number) => {
    const newSelections = [...deviceSelections];
    newSelections[index].isCollapsed = !newSelections[index].isCollapsed;
    setDeviceSelections(newSelections);
  };

  const handleGenerateReport = async () => {
    // Validate: at least one device selected
    const hasSelection = deviceSelections.some(
      selection => selection.deviceId > 0
    );

    if (!hasSelection) {
      alert('Pilih minimal satu MikroTik.');
      return;
    }

    setIsGenerating(true);
    try {
      const token = getAuthToken();
      const headers: HeadersInit = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      // Prepare devices data
      const selectedDeviceIds = deviceSelections
        .filter(s => s.deviceId > 0)
        .map(s => s.deviceId);

      console.log('[Report Frontend] Selected devices:', selectedDeviceIds);

      const queryParams = new URLSearchParams({
        year: selectedYear.toString(),
        month: selectedMonth.toString(),
        devices: JSON.stringify(selectedDeviceIds)
      });

      const res = await fetch(
        `${apiUrl}/api/reports/monthly?${queryParams.toString()}`,
        {
          method: 'GET',
          credentials: 'include',
          headers,
        }
      );

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || 'Gagal membuat laporan PDF.');
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const monthName = months[selectedMonth - 1].label;
      a.download = `Laporan-${monthName}-${selectedYear}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error: any) {
      console.error(error);
      alert(`Gagal membuat laporan: ${error.message}`);
    } finally {
      setIsGenerating(false);
    }
  };


  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      <header className="mb-6">
        <h1 className="text-3xl font-bold">Laporan Bulanan</h1>
        <p className="text-muted-foreground">
          Generate laporan bulanan dalam format PDF
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText size={24} />
            Generate Laporan PDF
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2 flex items-center gap-2">
                <Calendar size={14} />
                Tahun
              </label>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                className="w-full p-2 rounded-md bg-input border-border"
              >
                {years.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2 flex items-center gap-2">
                <Calendar size={14} />
                Bulan
              </label>
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
                className="w-full p-2 rounded-md bg-input border-border"
              >
                {months.map((month) => (
                  <option key={month.value} value={month.value}>
                    {month.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Device Selection */}
          <div className="pt-4 border-t space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Server size={18} />
                Pilih MikroTik
              </h3>
              <Button
                onClick={handleAddDevice}
                variant="outline"
                size="sm"
                disabled={devices.length === 0}
              >
                <Plus size={16} className="mr-2" />
                Tambah MikroTik
              </Button>
            </div>

            {deviceSelections.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <p>Klik "Tambah MikroTik" untuk memilih device</p>
              </div>
            )}

            {deviceSelections.map((selection, index) => (
              <Card key={index} className="border-2">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Button
                        onClick={() => handleToggleCollapse(index)}
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                      >
                        {selection.isCollapsed ? (
                          <ChevronDown size={16} />
                        ) : (
                          <ChevronUp size={16} />
                        )}
                      </Button>
                      <CardTitle className="text-base">
                        MikroTik #{index + 1}
                        {selection.deviceName && (
                          <span className="text-sm font-normal text-muted-foreground ml-2">
                            - {selection.deviceName}
                          </span>
                        )}
                      </CardTitle>
                    </div>
                    <Button
                      onClick={() => handleRemoveDevice(index)}
                      variant="ghost"
                      size="sm"
                    >
                      <X size={16} />
                    </Button>
                  </div>
                </CardHeader>
                {!selection.isCollapsed && (
                  <CardContent className="space-y-4">
                  <div className="relative">
                    <label className="block text-sm font-medium mb-2">
                      Pilih MikroTik
                    </label>
                    <select
                      value={selection.deviceId || ''}
                      onChange={(e) => {
                        const value = parseInt(e.target.value);
                        if (value) {
                          handleDeviceChange(index, value);
                        }
                        // Force blur to close dropdown immediately
                        setTimeout(() => {
                          (e.target as HTMLSelectElement).blur();
                        }, 0);
                      }}
                      className="w-full p-2 rounded-md bg-input border-border appearance-none cursor-pointer"
                      style={{ zIndex: 1 }}
                    >
                      <option value="">-- Pilih MikroTik --</option>
                      {devices.map((device) => (
                        <option key={device.id} value={device.id}>
                          {device.name} ({device.host})
                        </option>
                      ))}
                    </select>
                  </div>
                  </CardContent>
                )}
              </Card>
            ))}
          </div>

          <div className="pt-4 border-t">
            <Button
              onClick={handleGenerateReport}
              disabled={isGenerating || deviceSelections.length === 0}
              className="w-full"
              size="lg"
            >
              {isGenerating ? (
                <>
                  <Loader2 size={18} className="mr-2 animate-spin" />
                  Membuat Laporan...
                </>
              ) : (
                <>
                  <Download size={18} className="mr-2" />
                  Generate & Download PDF
                </>
              )}
            </Button>
          </div>

          <div className="text-sm text-muted-foreground bg-muted/50 p-4 rounded-md">
            <p className="font-semibold mb-2">Laporan mencakup:</p>
            <ul className="list-disc list-inside space-y-1">
              <li>Rata-rata CPU dan Memory usage per MikroTik</li>
              <li>Statistik SLA & downtime</li>
              <li>Semua client (PPPoE secret) yang ada di MikroTik</li>
              <li>Ringkasan data usage per client</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ReportPage;
