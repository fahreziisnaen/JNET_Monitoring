/**
 * docsRoutes.js — dokumentasi API billing via Scalar.
 * Mount: /api/billing/docs   (opt-in lewat BILLING_DOCS_ENABLED di index.js)
 *
 * Sumber kebenaran = openapi.yaml (ditulis tangan). Scalar hanya MERENDER spec
 * itu — embed via CDN standalone agar tanpa dependency npm & tanpa friksi
 * ESM/CommonJS. Untuk mode offline/bundled, ganti src <script> ke berkas lokal.
 */
const express = require('express');
const path = require('path');
const router = express.Router();

const SPEC_PATH = path.join(__dirname, '..', 'openapi.yaml');
const SCALAR_CDN = 'https://cdn.jsdelivr.net/npm/@scalar/api-reference';

// Spec mentah (Scalar mengambil dari sini)
router.get('/openapi.yaml', (req, res) => {
    res.type('text/yaml').sendFile(SPEC_PATH);
});

// Halaman dokumentasi
router.get('/', (req, res) => {
    res.type('html').send(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>JNET Billing API</title>
  </head>
  <body>
    <script
      id="api-reference"
      data-url="/api/billing/docs/openapi.yaml"
      data-configuration='{"theme":"purple"}'></script>
    <script src="${SCALAR_CDN}"></script>
  </body>
</html>`);
});

module.exports = router;
