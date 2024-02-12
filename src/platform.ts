import {
  API,
  Categories,
  Characteristic,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from 'homebridge';

import {PLATFORM_NAME, PLUGIN_NAME} from './settings.js';
import {CyncHub} from './hub.js';
import {CyncApi, CyncDevice, CyncHome} from './api.js';

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
  public readonly hub = new CyncHub(this);
  public readonly cyncApi = new CyncApi(this);

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {

    this.api.on('didFinishLaunching', () => {
      // connect to server
      this.hub.connect();

      // find devices now
      setImmediate(this.discoverDevices.bind(this));

      // check for devices every minute
      setInterval(this.discoverDevices.bind(this), 60000);
    });
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    // this.accessories.push(accessory);
  }

  /**
   * This is an example method showing how to register discovered accessories.
   * Accessories must only be registered once, previously created accessories
   * must not be registered again to prevent "duplicate UUID" errors.
   */
  async discoverDevices() {
    const discovered: string[] = [];

    await this.cyncApi.forEachDevice((device: CyncDevice, home: CyncHome) => {
      const uuid = this.api.hap.uuid.generate(`${device.mac}`);
      let accessory = this.accessories.find(accessory => accessory.UUID === uuid);

      if (!accessory) {
        this.log.info('Adding new accessory:', device.displayName);

        // create a new accessory
        accessory = new this.api.platformAccessory(device.displayName, uuid, Categories.LIGHTBULB);
        accessory.context.device = device;
        accessory.context.home = home;
        this.accessories.push(accessory);

        this.log.info(`Registering accessory ${device.displayName}`);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }

      this.hub.registerDevice(accessory, device, home);
      discovered.push(uuid);
    });

    const remove = this.accessories.filter((accessory) => !discovered.includes(accessory.UUID));
    for (const accessory of remove) {
      this.log.info('Removing accessory: ', accessory.displayName);
      this.hub.deregisterDevice(accessory);
    }
  }

}
