'use strict';

const { request } = require('./http');
const { encrypt, decryptMsg } = require('./crypto');

let SEQ = 0;
function sequence() {
  // monotonically increasing, like SonoffLAN (ms timestamp + counter)
  const ts = Date.now();
  SEQ = Math.max(SEQ + 1, ts);
  return String(SEQ);
}

/**
 * Send a LAN command to an eWeLink device (ported from local.py `send`).
 * @param {object} opts
 * @param {string} opts.host - "ip" or "ip:port" (defaults port 8081)
 * @param {string} opts.deviceid
 * @param {string} [opts.devicekey] - if set, payload is AES-encrypted
 * @param {string} opts.command - e.g. "switches"
 * @param {object} opts.params - e.g. {switches:[{switch:"on",outlet:0}]}
 * @param {number} [opts.timeout]
 * @param {number} [opts.retries] - retries on ECONNRESET (device web server is single-threaded)
 * @returns {Promise<"online"|"error">}  throws on connect/timeout failure
 */
async function send({ host, deviceid, devicekey, command, params, timeout = 4000, creRetries = 10, toRetries = 3 }) {
  let payload = {
    sequence: sequence(),
    deviceid,
    selfApikey: '123',
    data: params || {},
  };
  if (devicekey) payload = encrypt(payload, devicekey);

  let target = host;
  if (!target.includes(':')) target += ':8081';

  try {
    const r = await request(`http://${target}/zeroconf/${command}`, {
      method: 'POST',
      headers: { Connection: 'close' },
      body: payload,
      timeout,
    });
    const resp = r.json;
    if (!resp) {
      if (command === 'getState') return 'online';
      throw new Error(`non-JSON response (status ${r.status})`);
    }
    if (resp.error === 0) return 'online';
    if (command === 'getState') return 'online';
    throw new Error(`device error ${resp.error}: ${resp.msg || ''}`);
  } catch (e) {
    const msg = String(e.message);
    // Device web server is single-threaded; ECONNRESET means busy — retry quickly.
    if (creRetries > 0 && /ECONNRESET|socket hang up/i.test(msg)) {
      await new Promise((r) => setTimeout(r, 100));
      return send({ host, deviceid, devicekey, command, params, timeout, creRetries: creRetries - 1, toRetries });
    }
    // This device is sluggish and sometimes misses a request entirely — retry a few
    // times through the latency spikes before giving up (and falling back to cloud).
    if (toRetries > 0 && /timeout/i.test(msg)) {
      await new Promise((r) => setTimeout(r, 400));
      return send({ host, deviceid, devicekey, command, params, timeout, creRetries, toRetries: toRetries - 1 });
    }
    throw e;
  }
}

/**
 * Actively query a device's current state over LAN (POST /zeroconf/info).
 * Returns the decrypted params object (with `switches`) or null if the device
 * doesn't return state this way.
 */
async function queryInfo({ host, deviceid, devicekey, timeout = 5000 }) {
  let payload = { sequence: sequence(), deviceid, selfApikey: '123', data: {} };
  if (devicekey) payload = encrypt(payload, devicekey);

  let target = host.includes(':') ? host : `${host}:8081`;
  const r = await request(`http://${target}/zeroconf/info`, {
    method: 'POST', headers: { Connection: 'close' }, body: payload, timeout,
  });
  const resp = r.json;
  if (!resp) throw new Error(`non-JSON (status ${r.status})`);
  if (resp.error !== 0) throw new Error(`info error ${resp.error}`);
  if (resp.iv && resp.data) return decryptMsg({ data: resp.data, iv: resp.iv }, devicekey);
  if (resp.data && typeof resp.data === 'object') return resp.data;
  return null;
}

/** Turn a single outlet on/off on a multi-channel switch. */
function setOutlet({ host, deviceid, devicekey, outlet, on, timeout }) {
  return send({
    host, deviceid, devicekey, timeout,
    command: 'switches',
    params: { switches: [{ switch: on ? 'on' : 'off', outlet }] },
  });
}

/**
 * Parse Homey mDNS discovery txt records into a decryptable message and read outlet states.
 * The TXT carries data1..data4 (concatenated), encrypt flag, iv.
 * @returns {Array<{outlet:number, on:boolean}>|null}
 */
function parseState(txt, devicekey) {
  if (!txt) return null;
  const raw = ['data1', 'data2', 'data3', 'data4']
    .map((k) => txt[k]).filter(Boolean).join('');
  if (!raw) return null;

  let state;
  if (String(txt.encrypt) === 'true') {
    state = decryptMsg({ data: raw, iv: txt.iv }, devicekey);
  } else {
    try { state = JSON.parse(raw); } catch (e) { return null; }
  }
  if (!state || !Array.isArray(state.switches)) return null;
  return state.switches.map((s) => ({ outlet: s.outlet, on: s.switch === 'on' }));
}

module.exports = { send, setOutlet, queryInfo, parseState, sequence };
