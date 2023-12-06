import {Service, PlatformAccessory, CharacteristicValue} from 'homebridge';

import {CyncLightsPlatform} from './platform';
import {CyncHub} from "./hub";
import {CyncDevice, CyncHome, CyncPacketSubtype, CyncPacketType} from "./types";
import {rgb, hsv, RGB} from "color-convert/conversions";

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */

export class CyncLight {
  private service: Service;

  /**
   * These are just used to create a working example
   * You should implement your own code to track the state of your accessory
   */
  private states = {
    on: false,
    brightness: 100,
    colorTemp: 0,
    rgb: [0, 0, 0]
  };

  constructor(
    private readonly platform: CyncLightsPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly hub: CyncHub,
    public readonly device: CyncDevice,
    public readonly home: CyncHome
  ) {

    this.device.meshID = ((this.device.deviceID % this.home.id) % 1000) + (Math.round((this.device.deviceID % this.home.id) / 1000) * 256);

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'GE')
      .setCharacteristic(this.platform.Characteristic.Model, 'Cync Light')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.device.deviceID.toString());

    // get the LightBulb service if it exists, otherwise create a new LightBulb service
    // you can create multiple services for each accessory
    this.service = this.accessory.getService(this.platform.Service.Lightbulb) || this.accessory.addService(this.platform.Service.Lightbulb);

    // set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    this.service.setCharacteristic(this.platform.Characteristic.Name, this.device.displayName);

    // each service must implement at-minimum the "required characteristics" for the given service type
    // see https://developers.homebridge.io/#/service/Lightbulb

    // register handlers for the On/Off Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setOn.bind(this))                // SET - bind to the `setOn` method below
      .onGet(this.getOn.bind(this));               // GET - bind to the `getOn` method below

    // register handlers for the Brightness Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.Brightness)
      .onSet(this.setBrightness.bind(this));       // SET - bind to the 'setBrightness` method below
  }

  updateState(on: boolean, brightness: number, colorTemp: number | null = null, rgbValue: number[] | null = null) {
    this.states = {
      on: on,
      brightness: brightness,
      colorTemp: colorTemp || this.states.colorTemp,
      rgb: rgbValue || this.states.rgb,
    }

    this.platform.log.info(`Updating ${this.device.displayName} with states: ${JSON.stringify(this.states)}`);
    this.service.getCharacteristic(this.platform.Characteristic.On).updateValue(this.states.on);
    this.service.getCharacteristic(this.platform.Characteristic.Brightness).updateValue(this.states.brightness);
    this.service.getCharacteristic(this.platform.Characteristic.ColorTemperature).updateValue(this.homekitColorTemp(this.states.colorTemp));

    const hsv = rgb.hsv(this.states.rgb as RGB);
    this.service.getCharacteristic(this.platform.Characteristic.Hue).updateValue(hsv[0]);
    this.service.getCharacteristic(this.platform.Characteristic.Saturation).updateValue(hsv[1]);
  }

  homekitColorTemp(colorTemp : number) {
    return Math.round(((100 - colorTemp) * 360) / 100) + 140;
  }

  updateDeviceState() {
    const request = Buffer.alloc(16);
    request.writeUInt16BE(this.device.meshID, 3);
    request.writeUInt8(CyncPacketSubtype.Set, 5);
    request.writeUInt8((this.states.on ? 1 : 0), 8);
    request.writeUInt8(this.states.brightness, 9);
    request.writeUInt8(this.states.colorTemp, 10);
    request.writeUInt8(this.states.rgb[0], 11);
    request.writeUInt8(this.states.rgb[1], 12);
    request.writeUInt8(this.states.rgb[2], 13);

    const hash = ((496 + this.device.meshID + (this.states.on ? 1 : 0) + this.states.brightness + this.states.colorTemp + this.states.rgb[0] + this.states.rgb[1] + this.states.rgb[2]) % 256);
    request.writeUInt8(hash, 14);
    request.writeUInt8(0x7e, 15);

    this.hub.sendPacket(this.hub.createDevicePacket(this.device, CyncPacketType.Status, CyncPacketSubtype.Set, request), true);
  }

  async setOn(value: CharacteristicValue) {
    // implement your own code to turn your device on/off
    this.states.on = value as boolean;
    this.updateDeviceState();
  }

  async getOn(): Promise<CharacteristicValue> {
    return this.states.on;
  }

  async setBrightness(value: CharacteristicValue) {
    // implement your own code to set the brightness
    this.states.brightness = value as number;
    this.updateDeviceState();
  }

}
