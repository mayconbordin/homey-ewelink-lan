'use strict';

const Homey = require('homey');
const { EWeLinkCloud } = require('./lib/cloud');

/**
 * App-level eWeLink session shared by the driver/devices.
 * Credentials and the device cache (incl. devicekeys) are kept in app settings.
 */
class EWeLinkLanApp extends Homey.App {
  async onInit() {
    this.cloud = null;
    this.log('eWeLink LAN app started');
  }

  /** Build (and memoize) a logged-in cloud client from stored credentials. */
  async getCloud({ force = false } = {}) {
    if (this.cloud && this.cloud.token && !force) return this.cloud;

    const creds = this.homey.settings.get('credentials');
    if (!creds || !creds.username) throw new Error('Not logged in to eWeLink');

    const cloud = new EWeLinkCloud({ region: creds.region || 'us', token: creds.token || null });
    await cloud.login(creds.username, creds.password, creds.countryCode || '+55');
    // persist possibly-updated region/token
    this.homey.settings.set('credentials', { ...creds, region: cloud.region, token: cloud.token });
    this.cloud = cloud;
    return cloud;
  }

  /** Login + fetch devices; store credentials and a device cache. Returns the device list. */
  async loginAndCache({ username, password, countryCode }) {
    const cloud = new EWeLinkCloud({ region: 'us' });
    await cloud.login(username, password, countryCode || '+55');
    const devices = await cloud.getDevices();

    this.homey.settings.set('credentials', {
      username, password, countryCode: countryCode || '+55', region: cloud.region, token: cloud.token,
    });

    const cache = {};
    for (const d of devices) {
      cache[d.deviceid] = {
        deviceid: d.deviceid,
        devicekey: d.devicekey,
        name: d.name,
        uiid: d.extra && d.extra.uiid,
        params: d.params || {},
      };
    }
    this.homey.settings.set('deviceCache', cache);
    this.cloud = cloud;
    return devices;
  }

  getDeviceCache() {
    return this.homey.settings.get('deviceCache') || {};
  }
}

module.exports = EWeLinkLanApp;
