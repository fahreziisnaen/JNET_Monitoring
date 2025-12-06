const xml2js = require('xml2js');
const { Builder } = require('xml2js');
const pool = require('../config/database');

// Fungsi untuk ekstrak asset type dari placemark name
function extractAssetType(placemarkName) {
    if (!placemarkName) return null;
    
    const nameUpper = placemarkName.toUpperCase();
    
    // Cek kombinasi ODC+ODP
    if (nameUpper.includes('ODC+ODP') || nameUpper.includes('ODC & ODP') || nameUpper.includes('ODC DAN ODP')) {
        return 'ODC'; // Return ODC sebagai primary type untuk kombinasi
    }
    
    // Cek ODC
    if (nameUpper.startsWith('ODC') || nameUpper.includes(' ODC')) {
        return 'ODC';
    }
    
    // Cek ODP
    if (nameUpper.startsWith('ODP') || nameUpper.includes(' ODP')) {
        return 'ODP';
    }
    
    // Cek OLT
    if (nameUpper.startsWith('OLT') || nameUpper.includes(' OLT')) {
        return 'OLT';
    }
    
    // Cek Mikrotik (jika ada di KML)
    if (nameUpper.includes('MIKROTIK')) {
        return 'Mikrotik';
    }
    
    return null;
}

// Fungsi untuk parse splitter count dari description
function parseSplitterCount(description) {
    if (!description) return null;
    
    // Remove HTML tags jika ada
    const cleanDesc = description.replace(/<[^>]*>/g, ' ').trim();
    
    // Pattern 1: "4:8" atau "1:16" -> ambil angka setelah ":"
    const ratioMatch = cleanDesc.match(/(\d+):(\d+)/);
    if (ratioMatch) {
        return parseInt(ratioMatch[2], 10);
    }
    
    // Pattern 2: "8 port" atau "16 port" -> ambil angka sebelum "port"
    const portMatch = cleanDesc.match(/(\d+)\s*port/i);
    if (portMatch) {
        return parseInt(portMatch[1], 10);
    }
    
    // Pattern 3: "ODC 1:8<br>ODP 3:8" -> ambil yang terbesar atau ODP
    const multiMatch = cleanDesc.match(/ODP\s*(\d+):(\d+)/i);
    if (multiMatch) {
        return parseInt(multiMatch[2], 10);
    }
    
    const odcMatch = cleanDesc.match(/ODC\s*(\d+):(\d+)/i);
    if (odcMatch) {
        return parseInt(odcMatch[2], 10);
    }
    
    // Pattern 4: Hanya angka (misalnya "8")
    const numberMatch = cleanDesc.match(/^(\d+)$/);
    if (numberMatch) {
        return parseInt(numberMatch[1], 10);
    }
    
    return null;
}

// Fungsi untuk handle kombinasi ODC+ODP (membuat 2 record)
function createAssetsFromCombined(placemark, workspaceId, longitude, latitude, ownerName = null) {
    const assets = [];
    const name = placemark.name || 'Aset Tanpa Nama';
    const description = placemark.description || null;
    const splitterCount = parseSplitterCount(description);
    
    // Parse description untuk mendapatkan info ODC dan ODP terpisah
    const cleanDesc = description ? description.replace(/<[^>]*>/g, ' ') : '';
    const odcMatch = cleanDesc.match(/ODC\s*(\d+):(\d+)/i);
    const odpMatch = cleanDesc.match(/ODP\s*(\d+):(\d+)/i);
    
    // Buat ODC record
    if (odcMatch || name.toUpperCase().includes('ODC')) {
        const odcName = name.replace(/\+ODP|& ODP|DAN ODP/gi, '').trim() + ' (ODC)';
        const odcSplitter = odcMatch ? parseInt(odcMatch[2], 10) : splitterCount;
        assets.push([
            workspaceId,
            ownerName, // owner_name
            odcName,
            'ODC',
            parseFloat(latitude),
            parseFloat(longitude),
            description,
            odcSplitter,
            'terpasang' // connection_status default
        ]);
    }
    
    // Buat ODP record
    if (odpMatch || name.toUpperCase().includes('ODP')) {
        const odpName = name.replace(/ODC\+|ODC & |ODC DAN /gi, '').trim() + ' (ODP)';
        const odpSplitter = odpMatch ? parseInt(odpMatch[2], 10) : splitterCount;
        assets.push([
            workspaceId,
            ownerName, // owner_name
            odpName,
            'ODP',
            parseFloat(latitude),
            parseFloat(longitude),
            description,
            odpSplitter,
            'terpasang' // connection_status default
        ]);
    }
    
    // Jika tidak ada match spesifik, buat ODC sebagai default
    if (assets.length === 0) {
        assets.push([
            workspaceId,
            ownerName, // owner_name
            name + ' (ODC)',
            'ODC',
            parseFloat(latitude),
            parseFloat(longitude),
            description,
            splitterCount,
            'terpasang' // connection_status default
        ]);
    }
    
    return assets;
}

exports.importKml = async (req, res) => {
    const workspaceId = req.user.workspace_id;
    if (!req.file) {
        return res.status(400).json({ message: 'Tidak ada file yang diunggah.' });
    }

    try {
        const kmlContent = req.file.buffer.toString('utf8');
        const parser = new xml2js.Parser({ explicitArray: false, mergeAttrs: true });
        const result = await parser.parseStringPromise(kmlContent);
        // Tipe aset yang diizinkan pada map: Mikrotik -> OLT -> ODC -> ODP
        const ALLOWED_TYPES = ['Mikrotik', 'OLT', 'ODC', 'ODP'];
        
        const folders = result.kml.Document.Folder;
        if (!folders) {
            throw new Error('Format KML tidak valid atau tidak memiliki struktur Folder.');
        }

        const assetsToInsert = [];
        const folderArray = Array.isArray(folders) ? folders : [folders];

        for (const folder of folderArray) {
            // Ambil folder name sebagai owner_name
            const folderName = folder.name || null;
            if (!folder.Placemark) continue;
            
            const placemarkArray = Array.isArray(folder.Placemark) ? folder.Placemark : [folder.Placemark];

            for (const placemark of placemarkArray) {
                if (!placemark.Point || !placemark.Point.coordinates) continue;
                
                const coords = placemark.Point.coordinates.trim().split(',');
                if (coords.length < 2) continue;
                
                const longitude = parseFloat(coords[0]);
                const latitude = parseFloat(coords[1]);
                
                if (isNaN(latitude) || isNaN(longitude)) continue;
                
                const placemarkName = placemark.name || 'Aset Tanpa Nama';
                const assetType = extractAssetType(placemarkName);
                
                // Skip jika tidak bisa menentukan type
                if (!assetType || !ALLOWED_TYPES.includes(assetType)) {
                    console.log(`[KML Import] Mengabaikan placemark dengan type tidak dikenal: ${placemarkName}`);
                    continue;
                }
                
                const description = placemark.description || null;
                const splitterCount = parseSplitterCount(description);
                
                // Ambil owner_name dari ExtendedData jika ada, jika tidak gunakan folder name
                let ownerName = folderName;
                if (placemark.ExtendedData && placemark.ExtendedData.Data) {
                    const dataArray = Array.isArray(placemark.ExtendedData.Data) 
                        ? placemark.ExtendedData.Data 
                        : [placemark.ExtendedData.Data];
                    const ownerData = dataArray.find(d => {
                        const name = d.name || (d.$ && d.$.name);
                        return name === 'owner_name';
                    });
                    if (ownerData) {
                        // Try different possible value locations
                        const value = ownerData.value || ownerData._ || (ownerData.$ && ownerData.$.value);
                        if (value) {
                            ownerName = value;
                        }
                    }
                }
                
                // Handle kombinasi ODC+ODP
                const nameUpper = placemarkName.toUpperCase();
                if (nameUpper.includes('ODC+ODP') || nameUpper.includes('ODC & ODP') || nameUpper.includes('ODC DAN ODP')) {
                    const combinedAssets = createAssetsFromCombined(placemark, workspaceId, longitude, latitude, ownerName);
                    assetsToInsert.push(...combinedAssets);
                } else {
                    // Asset tunggal
                    assetsToInsert.push([
                        workspaceId,
                        ownerName, // owner_name
                        placemarkName,
                        assetType,
                        latitude,
                        longitude,
                        description,
                        splitterCount,
                        'terpasang' // connection_status default
                    ]);
                }
            }
        }
        
        if (assetsToInsert.length === 0) {
            return res.status(400).json({ message: 'Tidak ada aset valid yang bisa diimpor dari file KML ini.' });
        }

        // Insert assets tanpa parent_asset_id dulu
        const query = 'INSERT INTO network_assets (workspace_id, owner_name, name, type, latitude, longitude, description, splitter_count, connection_status) VALUES ?';
        const [insertResult] = await pool.query(query, [assetsToInsert]);
        const firstInsertId = insertResult.insertId;
        
        // Ambil semua asset yang baru saja di-insert menggunakan insertId range
        const [insertedAssets] = await pool.query(
            `SELECT id, name, type, latitude, longitude, description, splitter_count, connection_status 
             FROM network_assets 
             WHERE workspace_id = ? AND id >= ? AND id < (? + ?)
             ORDER BY id ASC`,
            [workspaceId, firstInsertId, firstInsertId, assetsToInsert.length]
        );
        
        // Tentukan parent_asset_id berdasarkan hierarchy dan proximity
        // Hierarchy baru: Mikrotik -> OLT -> ODC -> ODP
        
        // Pisahkan inserted assets berdasarkan type untuk efisiensi
        const insertedMikrotiks = insertedAssets.filter(a => a.type === 'Mikrotik');
        const insertedOLTs = insertedAssets.filter(a => a.type === 'OLT');
        const insertedODCs = insertedAssets.filter(a => a.type === 'ODC');
        const insertedODPs = insertedAssets.filter(a => a.type === 'ODP');
        
        // Loop untuk ODP: cari parent ODC atau ODP terdekat
        // Prioritas: ODC > ODP (karena ODC lebih tinggi dalam hierarchy)
        for (const odp of insertedODPs) {
            let parentId = null;
            
            // Prioritas 1: Cari ODC terdekat dari ODC yang baru di-insert
            if (insertedODCs.length > 0) {
                const nearestODC = insertedODCs
                    .map(odc => {
                        const latDiff = odc.latitude - odp.latitude;
                        const lonDiff = odc.longitude - odp.longitude;
                        const distance = Math.sqrt(latDiff * latDiff + lonDiff * lonDiff);
                        return { ...odc, distance };
                    })
                    .sort((a, b) => a.distance - b.distance)[0];
                
                if (nearestODC) {
                    parentId = nearestODC.id;
                }
            }
            
            // Prioritas 2: Jika tidak ada ODC yang baru di-insert, cari dari semua ODC di workspace
            if (!parentId) {
                const [odcAssets] = await pool.query(
                    `SELECT id, latitude, longitude 
                     FROM network_assets 
                     WHERE workspace_id = ? AND type = 'ODC' AND id != ?`,
                    [workspaceId, odp.id]
                );
                
                if (odcAssets.length > 0) {
                    const nearestODC = odcAssets
                        .map(odc => {
                            const latDiff = odc.latitude - odp.latitude;
                            const lonDiff = odc.longitude - odp.longitude;
                            const distance = Math.sqrt(latDiff * latDiff + lonDiff * lonDiff);
                            return { ...odc, distance };
                        })
                        .sort((a, b) => a.distance - b.distance)[0];
                    
                    if (nearestODC) {
                        parentId = nearestODC.id;
                    }
                }
            }
            
            // Prioritas 3: Jika tidak ada ODC, cari ODP terdekat dari ODP yang baru di-insert
            if (!parentId && insertedODPs.length > 1) {
                const otherODPs = insertedODPs.filter(o => o.id !== odp.id);
                if (otherODPs.length > 0) {
                    const nearestODP = otherODPs
                        .map(otherOdp => {
                            const latDiff = otherOdp.latitude - odp.latitude;
                            const lonDiff = otherOdp.longitude - odp.longitude;
                            const distance = Math.sqrt(latDiff * latDiff + lonDiff * lonDiff);
                            return { ...otherOdp, distance };
                        })
                        .sort((a, b) => a.distance - b.distance)[0];
                    
                    if (nearestODP) {
                        parentId = nearestODP.id;
                    }
                }
            }
            
            // Prioritas 4: Jika tidak ada, cari dari semua ODP di workspace
            if (!parentId) {
                const [odpAssets] = await pool.query(
                    `SELECT id, latitude, longitude 
                     FROM network_assets 
                     WHERE workspace_id = ? AND type = 'ODP' AND id != ?`,
                    [workspaceId, odp.id]
                );
                
                if (odpAssets.length > 0) {
                    const nearestODP = odpAssets
                        .map(odpAsset => {
                            const latDiff = odpAsset.latitude - odp.latitude;
                            const lonDiff = odpAsset.longitude - odp.longitude;
                            const distance = Math.sqrt(latDiff * latDiff + lonDiff * lonDiff);
                            return { ...odpAsset, distance };
                        })
                        .sort((a, b) => a.distance - b.distance)[0];
                    
                    if (nearestODP) {
                        parentId = nearestODP.id;
                    }
                }
            }
            
            // Update parent_asset_id jika ditemukan
            if (parentId) {
                await pool.query(
                    'UPDATE network_assets SET parent_asset_id = ? WHERE id = ? AND workspace_id = ?',
                    [parentId, odp.id, workspaceId]
                );
            }
        }
        
        // Loop untuk ODC: cari parent OLT terdekat
        for (const asset of insertedODCs) {
            let parentId = null;
            // Prioritas 1: Cari dari OLT yang baru di-insert
            if (insertedOLTs.length > 0) {
                const nearestParent = insertedOLTs
                    .map(parent => {
                        const latDiff = parent.latitude - asset.latitude;
                        const lonDiff = parent.longitude - asset.longitude;
                        const distance = Math.sqrt(latDiff * latDiff + lonDiff * lonDiff);
                        return { ...parent, distance };
                    })
                    .sort((a, b) => a.distance - b.distance)[0];
                
                if (nearestParent) {
                    parentId = nearestParent.id;
                }
            }
            
            // Prioritas 2: Jika tidak ada, cari dari semua OLT di workspace
            if (!parentId) {
                const [parentAssets] = await pool.query(
                    `SELECT id, latitude, longitude 
                     FROM network_assets 
                     WHERE workspace_id = ? AND type = 'OLT' AND id != ?`,
                    [workspaceId, asset.id]
                );
                
                if (parentAssets.length > 0) {
                    const nearestParent = parentAssets
                        .map(parent => {
                            const latDiff = parent.latitude - asset.latitude;
                            const lonDiff = parent.longitude - asset.longitude;
                            const distance = Math.sqrt(latDiff * latDiff + lonDiff * lonDiff);
                            return { ...parent, distance };
                        })
                        .sort((a, b) => a.distance - b.distance)[0];
                    
                    if (nearestParent) {
                        parentId = nearestParent.id;
                    }
                }
            }
            
            // Update parent_asset_id jika ditemukan
            if (parentId) {
                await pool.query(
                    'UPDATE network_assets SET parent_asset_id = ? WHERE id = ? AND workspace_id = ?',
                    [parentId, asset.id, workspaceId]
                );
            }
        }

        // Loop untuk OLT: cari parent Mikrotik terdekat
        for (const olt of insertedOLTs) {
            let parentId = null;

            // Prioritas 1: Cari dari Mikrotik yang baru di-insert
            if (insertedMikrotiks.length > 0) {
                const nearestMikrotik = insertedMikrotiks
                    .map(m => {
                        const latDiff = m.latitude - olt.latitude;
                        const lonDiff = m.longitude - olt.longitude;
                        const distance = Math.sqrt(latDiff * latDiff + lonDiff * lonDiff);
                        return { ...m, distance };
                    })
                    .sort((a, b) => a.distance - b.distance)[0];

                if (nearestMikrotik) {
                    parentId = nearestMikrotik.id;
                }
            }

            // Prioritas 2: Jika tidak ada, cari dari semua Mikrotik di workspace
            if (!parentId) {
                const [mikrotiks] = await pool.query(
                    `SELECT id, latitude, longitude 
                     FROM network_assets 
                     WHERE workspace_id = ? AND type = 'Mikrotik' AND id != ?`,
                    [workspaceId, olt.id]
                );

                if (mikrotiks.length > 0) {
                    const nearestMikrotik = mikrotiks
                        .map(m => {
                            const latDiff = m.latitude - olt.latitude;
                            const lonDiff = m.longitude - olt.longitude;
                            const distance = Math.sqrt(latDiff * latDiff + lonDiff * lonDiff);
                            return { ...m, distance };
                        })
                        .sort((a, b) => a.distance - b.distance)[0];

                    if (nearestMikrotik) {
                        parentId = nearestMikrotik.id;
                    }
                }
            }

            if (parentId) {
                await pool.query(
                    'UPDATE network_assets SET parent_asset_id = ? WHERE id = ? AND workspace_id = ?',
                    [parentId, olt.id, workspaceId]
                );
            }
        }

        res.status(200).json({ message: `Berhasil mengimpor ${assetsToInsert.length} aset dengan relasi parent-child.` });

    } catch (error) {
        console.error("KML IMPORT ERROR:", error);
        res.status(500).json({ message: 'Gagal memproses file KML.', error: error.message });
    }
};

exports.exportKml = async (req, res) => {
    const workspaceId = req.user.workspace_id;
    
    try {
        // Ambil semua assets dan clients dari workspace
        const [assets] = await pool.query(
            `SELECT id, name, type, latitude, longitude, description, splitter_count, owner_name, connection_status
             FROM network_assets
             WHERE workspace_id = ?
             ORDER BY owner_name, type, name`,
            [workspaceId]
        );
        
        const [clients] = await pool.query(
            `SELECT id, pppoe_secret_name, latitude, longitude, odp_asset_id
             FROM clients
             WHERE workspace_id = ?
             ORDER BY pppoe_secret_name`,
            [workspaceId]
        );
        
        // Group assets by owner_name
        const assetsByOwner = new Map();
        assets.forEach(asset => {
            const owner = asset.owner_name || 'Tanpa Pemilik';
            if (!assetsByOwner.has(owner)) {
                assetsByOwner.set(owner, []);
            }
            assetsByOwner.get(owner).push(asset);
        });
        
        // Build KML structure
        const kmlStructure = {
            kml: {
                $: { xmlns: 'http://www.opengis.net/kml/2.2' },
                Document: {
                    name: 'JNET Coverage Export',
                    description: `JNET Monitoring - Network Assets Coverage (Exported: ${new Date().toLocaleString('id-ID')})`,
                    Folder: []
                }
            }
        };
        
        // Add assets grouped by owner
        assetsByOwner.forEach((ownerAssets, ownerName) => {
            const placemarks = ownerAssets.map(asset => {
                const placemark = {
                    name: asset.name,
                    description: asset.splitter_count ? `${asset.type} ${asset.splitter_count}:${asset.splitter_count * 2}` : asset.type,
                    Point: {
                        coordinates: `${asset.longitude},${asset.latitude},0`
                    },
                    ExtendedData: {
                        Data: [
                            {
                                name: 'owner_name',
                                value: ownerName
                            },
                            {
                                name: 'type',
                                value: asset.type
                            },
                            {
                                name: 'connection_status',
                                value: asset.connection_status || 'terpasang'
                            }
                        ]
                    }
                };
                
                if (asset.description) {
                    placemark.ExtendedData.Data.push({
                        name: 'description',
                        value: asset.description
                    });
                }
                
                return placemark;
            });
            
            kmlStructure.kml.Document.Folder.push({
                name: ownerName,
                Placemark: placemarks.length === 1 ? placemarks[0] : placemarks
            });
        });
        
        // Add clients as separate folder if any
        if (clients.length > 0) {
            const clientPlacemarks = clients.map(client => ({
                name: `Client: ${client.pppoe_secret_name}`,
                description: 'Client PPPoE',
                Point: {
                    coordinates: `${client.longitude},${client.latitude},0`
                },
                ExtendedData: {
                    Data: [
                        {
                            name: 'type',
                            value: 'Client'
                        },
                        {
                            name: 'pppoe_secret_name',
                            value: client.pppoe_secret_name
                        }
                    ]
                }
            }));
            
            kmlStructure.kml.Document.Folder.push({
                name: 'Clients',
                Placemark: clientPlacemarks.length === 1 ? clientPlacemarks[0] : clientPlacemarks
            });
        }
        
        // Convert to XML
        const builder = new Builder({
            xmldec: { version: '1.0', encoding: 'UTF-8' },
            renderOpts: { pretty: true, indent: '  ', newline: '\n' }
        });
        
        const kmlXml = builder.buildObject(kmlStructure);
        
        // Set headers for download
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const filename = `jnet-coverage-export-${timestamp}.kml`;
        
        res.setHeader('Content-Type', 'application/vnd.google-earth.kml+xml');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(kmlXml);
        
    } catch (error) {
        console.error("KML EXPORT ERROR:", error);
        res.status(500).json({ message: 'Gagal mengekspor file KML.', error: error.message });
    }
};