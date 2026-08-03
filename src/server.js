'use strict';

const http = require('http');
const { getRouter } = require('stremio-addon-sdk');
const addonInterface = require('./addon');

const port = Number(process.env.PORT) || 7000;
const logRequests = ['1', 'true', 'yes'].includes(String(process.env.LOG_REQUESTS).toLowerCase());

const router = getRouter(addonInterface);

http
  .createServer((req, res) => {
    if (logRequests) {
      const started = Date.now();
      res.on('finish', () => {
        console.log(`${req.method} ${req.url} -> ${res.statusCode} (${Date.now() - started} ms)`);
      });
    }
    router(req, res, () => {
      res.writeHead(404);
      res.end();
    });
  })
  .listen(port, () => {
    console.log(
      `MTR Stremio addon beží na porte ${port} (manifest: /manifest.json)` +
        (logRequests ? ' – logovanie requestov zapnuté' : '')
    );
  });

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => process.exit(0));
}
