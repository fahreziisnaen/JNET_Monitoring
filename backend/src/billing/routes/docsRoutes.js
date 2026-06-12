const express = require('express');
const path = require('path');
const router = express.Router();

const SPEC_PATH = path.join(__dirname, '..', 'openapi.yaml');
const SCALAR_CDN = 'https://cdn.jsdelivr.net/npm/@scalar/api-reference';

const DOCS_CSP = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com",
    "font-src 'self' data: https://cdn.jsdelivr.net https://fonts.gstatic.com",
    "img-src 'self' data: https:",
    "connect-src 'self' https://cdn.jsdelivr.net",
    "worker-src 'self' blob:",
].join('; ');

router.get('/openapi.yaml', (req, res) => {
    res.type('text/yaml').sendFile(SPEC_PATH);
});

router.get('/', (req, res) => {
    res.setHeader('Content-Security-Policy', DOCS_CSP);
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
      data-url="${req.baseUrl}/openapi.yaml"
      data-configuration='{"theme":"purple"}'></script>
    <script src="${SCALAR_CDN}"></script>
  </body>
</html>`);
});

module.exports = router;
