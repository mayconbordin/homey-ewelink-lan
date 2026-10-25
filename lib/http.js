'use strict';

const http = require('http');
const https = require('https');

/**
 * Minimal promise-based JSON HTTP(S) client (no external deps, works in Homey runtime).
 * @returns {Promise<{status:number, json:any, body:string}>}
 */
function request(url, { method = 'GET', headers = {}, body = null, timeout = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const payload = body == null ? null : (typeof body === 'string' ? body : JSON.stringify(body));

    const opts = {
      method,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      headers: { ...headers },
    };
    if (payload != null) {
      opts.headers['Content-Length'] = Buffer.byteLength(payload);
      if (!opts.headers['Content-Type']) opts.headers['Content-Type'] = 'application/json';
    }

    const req = lib.request(opts, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) { /* non-JSON */ }
        resolve({ status: res.statusCode, json, body: data });
      });
    });

    req.on('error', reject);
    req.setTimeout(timeout, () => { req.destroy(new Error(`timeout ${timeout}ms`)); });
    if (payload != null) req.write(payload);
    req.end();
  });
}

module.exports = { request };
