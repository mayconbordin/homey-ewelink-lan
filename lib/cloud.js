'use strict';

const { request } = require('./http');
const { signBody } = require('./crypto');

// eWeLink v2 API (ported from SonoffLAN core/ewelink/cloud.py)
const APPID = 'R8Oq3y0eSZSYdKccHlrQzT1ACCOUT9Gv';
const APPSECRET = '1ve5Qk9GXfUhKAn1svnKwpAlxXkMarru';

const API = {
  cn: 'https://cn-apia.coolkit.cn',
  as: 'https://as-apia.coolkit.cc',
  us: 'https://us-apia.coolkit.cc',
  eu: 'https://eu-apia.coolkit.cc',
};

class EWeLinkCloud {
  constructor({ region = 'us', token = null } = {}) {
    this.region = region;
    this.token = token; // access token (at)
  }

  get host() { return API[this.region] || API.us; }

  /**
   * Login with email/phone + password. Handles the 10004 "wrong region" redirect.
   * @returns {Promise<{token:string, region:string, user:object}>}
   */
  async login(username, password, countryCode = '+55') {
    const payload = { password, countryCode };
    if (username.includes('@')) payload.email = username;
    else payload.phoneNumber = username.startsWith('+') ? username : `+${username}`;

    const body = JSON.stringify(payload); // sign the EXACT bytes we send
    const headers = {
      Authorization: 'Sign ' + signBody(Buffer.from(body, 'utf8'), APPSECRET),
      'Content-Type': 'application/json',
      'X-CK-Appid': APPID,
    };

    let resp = await request(`${this.host}/v2/user/login`, { method: 'POST', body, headers });
    if (resp.json && resp.json.error === 10004 && resp.json.data && resp.json.data.region) {
      this.region = resp.json.data.region;
      resp = await request(`${this.host}/v2/user/login`, { method: 'POST', body, headers });
    }
    if (!resp.json || resp.json.error !== 0) {
      throw new Error(`eWeLink login failed: ${resp.json ? resp.json.msg : resp.status}`);
    }
    this.token = resp.json.data.at;
    return { token: this.token, region: this.region, user: resp.json.data.user };
  }

  get authHeaders() {
    return { Authorization: 'Bearer ' + this.token, 'X-CK-Appid': APPID };
  }

  /** Fetch all devices (itemData carries deviceid, devicekey, name, extra.uiid, params). */
  async getDevices() {
    const resp = await request(`${this.host}/v2/device/thing?num=0`, { headers: this.authHeaders, timeout: 10000 });
    if (!resp.json || resp.json.error !== 0) {
      throw new Error(`getDevices failed: ${resp.json ? resp.json.msg : resp.status}`);
    }
    return (resp.json.data.thingList || [])
      .map((i) => i.itemData)
      .filter((d) => d && d.deviceid);
  }

  /** Cloud fallback control: push params (e.g. {switches:[...]}) to a device. */
  async setDeviceStatus(deviceid, params) {
    const resp = await request(`${this.host}/v2/device/thing/status`, {
      method: 'POST',
      headers: this.authHeaders,
      body: { type: 1, id: deviceid, params },
      timeout: 8000,
    });
    if (!resp.json || resp.json.error !== 0) {
      throw new Error(`cloud setDeviceStatus failed: ${resp.json ? resp.json.msg : resp.status}`);
    }
    return true;
  }

  /** Cloud read of a device's current params (fallback status). */
  async getDeviceStatus(deviceid, params = ['switches']) {
    const qs = `type=1&id=${encodeURIComponent(deviceid)}&params=${encodeURIComponent(params.join('|'))}`;
    const resp = await request(`${this.host}/v2/device/thing/status?${qs}`, { headers: this.authHeaders, timeout: 8000 });
    if (!resp.json || resp.json.error !== 0) {
      throw new Error(`cloud getDeviceStatus failed: ${resp.json ? resp.json.msg : resp.status}`);
    }
    return resp.json.data.params || {};
  }
}

module.exports = { EWeLinkCloud, APPID, APPSECRET, API };
