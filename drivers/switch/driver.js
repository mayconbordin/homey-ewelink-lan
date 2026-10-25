'use strict';

const Homey = require('homey');

// MVP scope: only the "Quadro de Luz" T5 (per project decision).
const TARGET_DEVICEID = '100251ed09';

class SwitchDriver extends Homey.Driver {
  async onInit() {
    this.log('eWeLink LAN switch driver ready');
  }

  onPair(session) {
    session.setHandler('list_devices', async () => {
      const creds = this.homey.settings.get('credentials');
      if (!creds || !creds.username || !creds.password) {
        throw new Error('Please enter your eWeLink login in the app settings first (Configure app), then add the device.');
      }
      // (re)login and refresh the device cache so we have fresh devicekeys
      await this.homey.app.loginAndCache(creds);

      const cache = this.homey.app.getDeviceCache();
      const dev = cache[TARGET_DEVICEID];
      if (!dev) throw new Error(`Device ${TARGET_DEVICEID} not found in your eWeLink account`);

      // channel count: prefer `configure` (real gangs) over `switches` (may carry a phantom outlet)
      const p = dev.params || {};
      const channels = (Array.isArray(p.configure) && p.configure.length)
        || (Array.isArray(p.switches) && p.switches.length)
        || 1;

      const base = dev.name || 'eWeLink';
      const out = [];
      for (let outlet = 0; outlet < channels; outlet++) {
        out.push({
          name: `${base} - CH${outlet + 1}`,
          data: { id: `${dev.deviceid}:${outlet}`, deviceid: dev.deviceid, outlet },
          store: { devicekey: dev.devicekey },
          settings: { ip: '' },
        });
      }
      return out;
    });
  }
}

module.exports = SwitchDriver;
