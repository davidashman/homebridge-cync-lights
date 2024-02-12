import {Service, PlatformAccessory, CharacteristicValue} from 'homebridge';

import {CyncLightsPlatform} from './platform.js';
import {CyncHub, CyncPacketSubtype, CyncPacketType} from './hub.js';
import {CyncDevice, CyncHome} from './api.js';
import convert from 'color-convert';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */

const DEVICES_WITH_BRIGHTNESS = [1, 5, 6, 7, 8, 9, 10, 11, 13, 14, 15, 17, 18, 19, 20, 21, 22, 23, 24, 25,
  26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 48, 49, 55, 56, 80, 81, 82, 83, 85, 128, 129, 130, 131, 132, 133,
  134, 135, 136, 137, 138, 139, 140, 141, 142, 143, 144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 156, 158,
  159, 160, 161, 162, 163, 164, 165];
const DEVICES_WITH_COLOR_TEMP = [5, 6, 7, 8, 10, 11, 14, 15, 19, 20, 21, 22, 23, 25, 26, 28, 29, 30, 31,
  32, 33, 34, 35, 80, 82, 83, 85, 129, 130, 131, 132, 133, 135, 136, 137, 138, 139, 140, 141, 142, 143, 144, 145,
  146, 147, 153, 154, 156, 158, 159, 160, 161, 162, 163, 164, 165];
const DEVICES_WITH_RGB = [6, 7, 8, 21, 22, 23, 30, 31, 32, 33, 34, 35, 131, 132, 133, 137, 138, 139, 140,
  141, 142, 143, 146, 147, 153, 154, 156, 158, 159, 160, 161, 162, 163, 164, 165];

export class CyncLight {
  private service: Service;

  private states = {
    on: false,
    brightness: 0,
    colorTemp: 13,
    rgb: [255, 255, 255],
  };

  constructor(
    private readonly platform: CyncLightsPlatform,
    public readonly accessory: PlatformAccessory,
    public readonly hub: CyncHub,
    public readonly device: CyncDevice,
    public readonly home: CyncHome,
    public offline: boolean = false,
  ) {

    this.device.meshID = ((this.device.deviceID % this.home.id) % 1000) + (Math.round((this.device.deviceID % this.home.id) / 1000) * 256);

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'GE')
      .setCharacteristic(this.platform.Characteristic.Model, `Cync Direct Connect Light (${this.device.deviceType})`)
      .setCharacteristic(this.platform.Characteristic.FirmwareRevision, this.device.firmwareVersion)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.device.mac);

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


    if (DEVICES_WITH_BRIGHTNESS.includes(this.device.deviceType)) {
      this.service.getCharacteristic(this.platform.Characteristic.Brightness)
        .onSet(this.setBrightness.bind(this))
        .onGet(this.getBrightness.bind(this));
    }

    if (DEVICES_WITH_COLOR_TEMP.includes(this.device.deviceType)) {
      this.service.getCharacteristic(this.platform.Characteristic.ColorTemperature)
        .onSet(this.setHomekitColorTemp.bind(this))
        .onGet(this.getHomekitColorTemp.bind(this));
    }

    if (DEVICES_WITH_RGB.includes(this.device.deviceType)) {
      this.service.getCharacteristic(this.platform.Characteristic.Hue)
        .onSet(this.setHue.bind(this))
        .onGet(this.getHue.bind(this));

      this.service.getCharacteristic(this.platform.Characteristic.Saturation)
        .onSet(this.setSaturation.bind(this))
        .onGet(this.getSaturation.bind(this));
    }
  }

  updateState(on: boolean, brightness: number, colorTemp: number | null = null, rgbValue: number[] | null = null) {
    this.states = {
      on: on,
      brightness: brightness,
      colorTemp: colorTemp || this.states.colorTemp,
      rgb: rgbValue || this.states.rgb,
    };

    this.platform.log.info(`Received update for ${this.accessory.displayName} (${this.accessory.UUID}) with states: `,
      JSON.stringify(this.states));
    this.service.getCharacteristic(this.platform.Characteristic.On).updateValue(this.states.on);

    if (DEVICES_WITH_BRIGHTNESS.includes(this.device.deviceType)) {
      this.service.getCharacteristic(this.platform.Characteristic.Brightness).updateValue(this.states.brightness);
    }

    if (DEVICES_WITH_COLOR_TEMP.includes(this.device.deviceType)) {
      this.service.getCharacteristic(this.platform.Characteristic.ColorTemperature)
        .updateValue(this.toHomekitColorTemp(this.states.colorTemp));
    }

    if (DEVICES_WITH_RGB.includes(this.device.deviceType)) {
      const hsv = this.hsv();
      this.service.getCharacteristic(this.platform.Characteristic.Hue).updateValue(hsv[0]);
      this.service.getCharacteristic(this.platform.Characteristic.Saturation).updateValue(hsv[1]);
    }
  }

  updateDeviceOn() {
    const request = Buffer.alloc(13);
    request.writeUInt16BE(this.device.meshID, 3);
    request.writeUInt8(CyncPacketSubtype.SetOn, 5);
    request.writeUInt8((this.states.on ? 1 : 0), 8);

    const hash = ((429 + this.device.meshID + (this.states.on ? 1 : 0)) % 256);
    request.writeUInt8(hash, 11);
    request.writeUInt8(0x7e, 12);

    this.hub.queueDevicePacket(this.device, CyncPacketType.Status, CyncPacketSubtype.SetOn, request);
  }

  updateDeviceState() {
    const request = Buffer.alloc(16);
    request.writeUInt16BE(this.device.meshID, 3);
    request.writeUInt8(CyncPacketSubtype.SetState, 5);
    request.writeUInt8((this.states.on ? 1 : 0), 8);
    request.writeUInt8(this.states.brightness, 9);
    request.writeUInt8(this.states.colorTemp, 10);
    request.writeUInt8(this.states.rgb[0], 11);
    request.writeUInt8(this.states.rgb[1], 12);
    request.writeUInt8(this.states.rgb[2], 13);

    const hash = ((496 + this.device.meshID + (this.states.on ? 1 : 0) +
      this.states.brightness + this.states.colorTemp + this.states.rgb[0] +
      this.states.rgb[1] + this.states.rgb[2]) % 256);
    request.writeUInt8(hash, 14);
    request.writeUInt8(0x7e, 15);

    this.hub.queueDevicePacket(this.device, CyncPacketType.Status, CyncPacketSubtype.SetState, request);
  }

  checkOffline() {
    if (this.offline) {
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  setOn(value: CharacteristicValue) {
    if (!this.offline) {
      // implement your own code to turn your device on/off
      this.states.on = value as boolean;
      this.platform.log.info(`Adjusting on state of ${this.accessory.displayName} (${this.accessory.UUID}) to ${value}: `,
        this.states.on);
      this.updateDeviceOn();
    }
  }

  getOn() {
    this.checkOffline();
    this.platform.log.info(`On state of ${this.accessory.displayName} (${this.accessory.UUID}) requested: ${this.states.on}`);
    return this.states.on;
  }

  setBrightness(value: CharacteristicValue) {
    if (!this.offline) {
      // implement your own code to set the brightness
      this.states.brightness = value as number;
      this.platform.log.info(`Adjusting brightness of ${this.accessory.displayName} (${this.accessory.UUID}) to ${value}`);
      this.updateDeviceState();
    }
  }

  getBrightness() {
    this.checkOffline();
    this.platform.log.info(`Brightness state of ${this.accessory.displayName} (${this.accessory.UUID}) requested: `,
      this.states.brightness);
    return this.states.brightness;
  }

  toHomekitColorTemp(value) {
    return Math.round(1000000 / (2000 + (51 * value)));
  }

  toCyncColorTemp(value) {
    return Math.round(((1000000 / value) - 2000) / 51);
  }

  setHomekitColorTemp(value: CharacteristicValue) {
    if (!this.offline) {
      this.states.colorTemp = this.toCyncColorTemp(value);
      this.platform.log.info(`Adjusting HK color temp of ${this.accessory.displayName} (${this.accessory.UUID}) to ${value}: `,
        this.states.colorTemp);
      this.updateDeviceState();
    }
  }

  getHomekitColorTemp() {
    this.checkOffline();
    const hkColorTemp = this.toHomekitColorTemp(this.states.colorTemp);
    this.platform.log.info(`Color temp state of ${this.accessory.displayName} (${this.accessory.UUID}) requested: `,
      `${this.states.colorTemp} => ${hkColorTemp}`);
    return hkColorTemp;
  }

  hsv() {
    return convert.rgb.hsv(this.states.rgb[0], this.states.rgb[1], this.states.rgb[2]);
  }

  setHue(value: CharacteristicValue) {
    if (!this.offline) {
      const hsvValue = this.hsv();
      hsvValue[0] = value as number;
      this.states.rgb = convert.hsv.rgb(hsvValue);
      this.updateDeviceState();
    }
  }

  getHue() {
    this.checkOffline();
    const hsv = this.hsv();
    this.platform.log.info(`Hue state of ${this.accessory.displayName} (${this.accessory.UUID}) requested: `,
      `${this.states.rgb} => ${hsv[0]}`);
    return hsv[0];
  }

  setSaturation(value: CharacteristicValue) {
    if (!this.offline) {
      const hsvValue = this.hsv();
      hsvValue[1] = value as number;
      this.states.rgb = convert.hsv.rgb(hsvValue);
      this.updateDeviceState();
    }
  }

  getSaturation() {
    this.checkOffline();
    const hsv = this.hsv();
    this.platform.log.info(`Saturation state of ${this.accessory.displayName} (${this.accessory.UUID}) requested: `,
      `${this.states.rgb} => ${hsv[1]}`);
    return hsv[1];
  }

}
