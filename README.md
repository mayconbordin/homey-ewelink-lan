# eWeLink LAN (Homey app)

Local (LAN) control of eWeLink / SONOFF switches on [Homey](https://homey.app/),
with cloud fallback. The control protocol is ported from Home Assistant's
[SonoffLAN](https://github.com/AlexxIT/SonoffLAN) integration.

## Why this exists

The official (closed-source) eWeLink Homey app controls devices **through the
eWeLink cloud only**. If a device's cloud link is flaky — it drops the
connection, misses keepalives, or is slow to respond — commands from Homey fail
silently: Homey shows the new state but the device never changes. Meanwhile the
eWeLink phone app keeps working, because on the same Wi-Fi it talks to the
device **directly over the LAN**.

This app does the same thing: it sends on/off commands straight to the device on
your local network, so control keeps working even when the device's cloud link
is down.

## How it works

| Concern  | Transport | Why |
|----------|-----------|-----|
| **Control** (on/off) | **LAN first**, cloud fallback | LAN is fast and works without the cloud. If the LAN send fails, it retries over the cloud. |
| **Status** (current state) | **Cloud poll** (every 60 s) | This device's LAN/mDNS status advertisements proved stale and unreliable, so state is read from the cloud. |
| **Discovery** (device IP) | mDNS (`_ewelink._tcp`) | Used only to locate the device's IP address; a static IP can also be set per device. |

- **Login:** the eWeLink cloud API (v2) is used **once** to fetch each device's
  local encryption key (`devicekey`). Credentials are entered in the app's
  settings page and stored only on your Homey — they are never sent anywhere
  else.
- **LAN protocol:** commands are `POST`ed to `http://<device-ip>:8081/zeroconf/switches`,
  AES-128-CBC encrypted with `MD5(devicekey)` (matching SonoffLAN).

## Requirements

- A Homey Pro (SDK3, firmware `>= 5.0.0`).
- The device(s) and the Homey on the **same Wi-Fi / LAN**.
- An eWeLink account the devices are already paired to (via the eWeLink phone app).
- Devices must have **LAN mode / local control** enabled in the eWeLink app.

## Install (development)

The app is not published to the Homey App Store. Run it from source with the
[Homey CLI](https://apps.developer.homey.app/the-basics/getting-started):

```bash
npm install -g homey
homey login
homey app run           # install + stream logs on the connected Homey
# or, for a selected remote Homey:
homey app run --remote
```

To install it permanently (survives reboots, no CLI session needed):

```bash
homey app install
```

## Setup

1. Install/run the app (above).
2. In Homey, open the app's **settings** (Apps → eWeLink LAN → Configure app)
   and enter your eWeLink **email**, **password**, and **country code**
   (e.g. `+55`). Save.
3. Add the device: **Devices → ＋ Add → eWeLink LAN**. Each physical gang/channel
   is added as its own on/off device.
4. (Optional) Set a **static IP** per device in its advanced settings if you
   don't want to rely on mDNS discovery.

## Project layout

```
app.js                      app entry: cloud login + device cache
app.json                    Homey app manifest (driver, discovery, settings)
settings/index.html         account login page
drivers/switch/driver.js    pairing (lists the device's channels)
drivers/switch/device.js    per-channel control + status logic
lib/cloud.js                eWeLink v2 cloud API client
lib/lan.js                  LAN send / encryption / state parsing
lib/crypto.js               AES + MD5 key + request signing
lib/http.js                 dependency-free HTTP/HTTPS client
```

## Status / scope

MVP: scoped to a single 3-gang SONOFF T5 switch. The design generalizes to other
eWeLink switches, but pairing currently targets one configured device id — widen
`TARGET_DEVICEID` in `drivers/switch/driver.js` (or remove the filter) to expose
more.

## Credits

Protocol and crypto ported from [AlexxIT/SonoffLAN](https://github.com/AlexxIT/SonoffLAN).
Not affiliated with or endorsed by eWeLink / SONOFF / ITEAD.

## License

MIT
