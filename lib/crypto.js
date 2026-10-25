'use strict';

const crypto = require('crypto');

/**
 * eWeLink LAN payload encryption, ported from SonoffLAN (core/ewelink/local.py).
 * Non-DIY devices encrypt the `data` field with AES-128-CBC using key = MD5(devicekey),
 * a random 16-byte IV, PKCS7 padding; `data` and `iv` are base64-encoded.
 */

function md5Key(devicekey) {
  return crypto.createHash('md5').update(Buffer.from(devicekey, 'utf8')).digest(); // 16 bytes
}

/**
 * Encrypt a payload in place (mirrors local.py `encrypt`).
 * @param {object} payload - must contain `data` (object); mutated to carry encrypted form.
 * @param {string} devicekey
 * @returns {object} the same payload with encrypt/data/iv set.
 */
function encrypt(payload, devicekey) {
  const plaintext = Buffer.from(JSON.stringify(payload.data), 'utf8');
  const key = md5Key(devicekey);
  const iv = crypto.randomBytes(16);

  const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  payload.encrypt = true;
  payload.data = ciphertext.toString('base64');
  payload.iv = iv.toString('base64');
  return payload;
}

/**
 * Decrypt the base64 `data`/`iv` of a message (mirrors local.py `decrypt`/`decrypt_msg`).
 * @param {{data:string, iv:string}} msg
 * @param {string} devicekey
 * @returns {object|null} parsed JSON state, or null if empty.
 */
function decryptMsg(msg, devicekey) {
  if (!msg || !msg.data) return null;
  const key = md5Key(devicekey);
  const iv = Buffer.from(msg.iv, 'base64');
  const ciphertext = Buffer.from(msg.data, 'base64');

  const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
  let out = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  // Fix from SonoffLAN: some firmwares append trailing 0x02
  out = stripTrailing(out, 0x02);
  return JSON.parse(out.toString('utf8'));
}

function stripTrailing(buf, byte) {
  let end = buf.length;
  while (end > 0 && buf[end - 1] === byte) end -= 1;
  return buf.subarray(0, end);
}

/**
 * eWeLink v2 cloud request signature: base64( HMAC-SHA256(APP_SECRET, body) ).
 */
function signBody(bodyBuffer, appSecret) {
  return crypto.createHmac('sha256', Buffer.from(appSecret, 'utf8')).update(bodyBuffer).digest('base64');
}

module.exports = { encrypt, decryptMsg, signBody, md5Key };
