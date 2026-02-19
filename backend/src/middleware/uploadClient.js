const multer = require('multer');
const path = require('path');
const fs = require('fs');

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = './public/uploads/clients/';
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        // Sanitize PPPoE name from req.body.pppoe_secret_name
        const pppoeName = req.body.pppoe_secret_name ? req.body.pppoe_secret_name.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_') : 'unknown';
        const uniqueSuffix = `client-${pppoeName}-${Date.now()}${path.extname(file.originalname)}`;
        cb(null, uniqueSuffix);
    }
});

const uploadClient = multer({
    storage: storage,
    limits: { fileSize: 5000000 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        const filetypes = /jpeg|jpg|png|gif|webp/;
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = filetypes.test(file.mimetype);

        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Error: Hanya file gambar yang diizinkan!'));
        }
    }
});

module.exports = uploadClient;
