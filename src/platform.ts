import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic,
} from 'homebridge';

import {PLATFORM_NAME, PLUGIN_NAME} from './settings';
import {CyncHub} from './hub';

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class CyncLightsPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];

  // public readonly auth: CyncAuth;
  public readonly hub: CyncHub;
  private accessToken = '';
  private accessTokenExpires = 0;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.log.debug('Finished initializing platform:', this.config.name);
    // this.auth = new CyncAuth(this);
    this.hub = new CyncHub(this);

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');

      this.getAccessToken()
        .then((accessToken) => {
          Promise.all([
            this.discoverDevices(accessToken),
            this.hub.connect(),
          ]);
        })
        .catch((error) => {
          this.log.error(error.message);
        });
    });
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);
  }

  async getAccessToken() {
    if (!this.config.refreshToken) {
      throw new Error('Please go to the plugin settings and log into Cync.');
    }

    if (this.accessTokenExpires < Date.now()) {
      // first, check the access_token
      this.log.info('Logging into Cync...');

      const payload = {refresh_token: this.config.refreshToken};
      const token = await fetch('https://api.gelighting.com/v2/user/token/refresh', {
        method: 'post',
        body: JSON.stringify(payload),
        headers: {'Content-Type': 'application/json'},
      });

      const data = await token.json();
      if (!data.access_token) {
        this.log.info(`Cync login response: ${JSON.stringify(data)}`);
        throw new Error('Unable to authenticate with Cync servers.  Please verify you have a valid refresh token.');
      }

      this.accessToken = data.access_token;
      // We will refresh it one day before it expires
      this.accessTokenExpires = Date.now() + data.expires_in - 86400;
    }

    return this.accessToken;
  }

  /**
   * This is an example method showing how to register discovered accessories.
   * Accessories must only be registered once, previously created accessories
   * must not be registered again to prevent "duplicate UUID" errors.
   */
  async discoverDevices(accessToken) {
    this.log.info('Discovering homes...');
    const r = await fetch(`https://api.gelighting.com/v2/user/${this.config.userID}/subscribe/devices`, {
      headers: {'Access-Token': accessToken},
    });
    const data = await r.json();
    this.log.info(`Received home response: ${JSON.stringify(data)}`);

    for (const home of data) {
      const homeR = await fetch(`https://api.gelighting.com/v2/product/${home.product_id}/device/${home.id}/property`, {
        headers: {'Access-Token': accessToken},
      });
      const homeData = await homeR.json();
      this.log.info(`Received device response: ${JSON.stringify(homeData)}`);
      if (homeData.bulbsArray && homeData.bulbsArray.length > 0) {
        const discovered: string[] = [];

        for (const device of homeData.bulbsArray) {
          const uuid = this.api.hap.uuid.generate(`${device.mac}`);
          let accessory = this.accessories.find(accessory => accessory.UUID === uuid);

          if (!accessory) {
            this.log.info('Adding new accessory:', device.displayName);

            // create a new accessory
            accessory = new this.api.platformAccessory(device.displayName, uuid);

            this.log.info(`Registering accessory ${device.displayName}`);
            this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
          }

          this.hub.registerDevice(accessory, device, home);
          discovered.push(uuid);
        }

        const remove = this.accessories.filter((accessory) => !discovered.includes(accessory.UUID));
        for (const accessory of remove) {
          this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        }
      }
    }
  }

}
