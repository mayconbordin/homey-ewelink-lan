'use strict';

const Homey = require('homey');
const lan = require('../../lib/lan');

/**
 * Control goes over the LAN (fast, works even when the device's cloud link is down).
 * Status comes from the eWeLink cloud, which is reliable for this device — its mDNS
 * state advertisements proved stale/incorrect, so mDNS is used only to find the IP.
 */
class SwitchDevice extends Homey.Device {
  async onInit() {
    const data = this.getData();
    this.deviceid = data.deviceid;
    this.outlet = data.outlet;
    this.devicekey = this.getStoreValue('devicekey');
    this.host = null; // "ip:port", from the static-IP setting or mDNS discovery
    this.expectedOn = null; // value we last commanded, held until the cloud confirms it
    this.expectedTimer = null;

    this.registerCapabilityListener('onoff', (value) => this.setOnoff(value));

    const ip = (this.getSetting('ip') || '').trim();
    if (ip) this.host = ip.includes(':') ? ip : `${ip}:8081`;

    // Status from cloud: once now, then every 60s.
    this.pollCloud().catch(() => {});
    this.poll = this.homey.setInterval(() => this.pollCloud().catch(() => {}), 60 * 1000);

    this.log(`init ${this.deviceid} outlet ${this.outlet} (host=${this.host || 'discovery'})`);
  }

  async onUninit() {
    if (this.poll) this.homey.clearInterval(this.poll);
    this.clearExpected();
  }

  // ---- discovery: resolve the device IP only (mDNS state is unreliable here) ----
  onDiscoveryResult(result) {
    return result.id === this.deviceid; // all outlets of this device share one mDNS id
  }

  onDiscoveryAvailable(result) { this.applyDiscovery(result); }
  onDiscoveryAddressChanged(result) { this.applyDiscovery(result); }
  onDiscoveryLastSeenChanged(result) { this.applyDiscovery(result); }

  applyDiscovery(result) {
    if (result.address) this.host = `${result.address}:${result.port || 8081}`;
    this.setAvailable().catch(() => {});
  }

  // ---- control: LAN first, cloud fallback ----
  async setOnoff(value) {
    const on = !!value;

    // Hold this value in the UI until the cloud confirms it (or 90s safety timeout).
    this.expectedOn = on;
    if (this.expectedTimer) this.homey.clearTimeout(this.expectedTimer);
    this.expectedTimer = this.homey.setTimeout(() => { this.expectedOn = null; this.expectedTimer = null; }, 90 * 1000);

    let ok = false;
    if (this.host) {
      try {
        await lan.setOutlet({ host: this.host, deviceid: this.deviceid, devicekey: this.devicekey, outlet: this.outlet, on });
        this.log(`LAN set outlet ${this.outlet} -> ${on}`);
        ok = true;
      } catch (e) {
        this.log(`LAN control failed (${e.message}); falling back to cloud`);
      }
    }

    if (!ok) {
      try {
        const cloud = await this.homey.app.getCloud();
        await cloud.setDeviceStatus(this.deviceid, { switches: [{ switch: on ? 'on' : 'off', outlet: this.outlet }] });
        this.log(`cloud set outlet ${this.outlet} -> ${on}`);
        ok = true;
      } catch (e) {
        this.clearExpected();
        this.error(`control failed on both LAN and cloud: ${e.message}`);
        throw new Error('Could not reach the device (LAN and cloud both failed)');
      }
    }

    this.setCapabilityValue('onoff', on).catch(() => {});
    // Confirm against the cloud shortly after, to clear the hold and catch reality.
    this.homey.setTimeout(() => this.pollCloud().catch(() => {}), 8000);
  }

  async pollCloud() {
    const cloud = await this.homey.app.getCloud();
    const params = await cloud.getDeviceStatus(this.deviceid, ['switches']);
    if (!Array.isArray(params.switches)) return;
    const mine = params.switches.find((s) => s.outlet === this.outlet);
    if (mine) this.applyMeasuredState(mine.switch === 'on', 'cloud');
  }

  /**
   * Apply a cloud-observed state. While a command is pending confirmation, hold our
   * commanded value and ignore a conflicting reading; clear the hold once the cloud
   * agrees — so external/physical changes still sync afterwards.
   */
  applyMeasuredState(on, source) {
    if (this.expectedOn !== null) {
      if (on !== this.expectedOn) {
        this.log(`holding ${this.expectedOn}; ${source} reports ${on}`);
        return;
      }
      this.clearExpected();
    }
    this.setCapabilityValue('onoff', on).catch(() => {});
  }

  clearExpected() {
    this.expectedOn = null;
    if (this.expectedTimer) { this.homey.clearTimeout(this.expectedTimer); this.expectedTimer = null; }
  }
}

module.exports = SwitchDevice;
