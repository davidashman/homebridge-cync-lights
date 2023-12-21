import fetch from 'node-fetch';
import {CyncLightsPlatform} from './platform.js';

export interface CyncHome {

  readonly id: number;
  readonly product_id: string;

}

interface CyncHomeDevices {

  readonly bulbsArray: CyncDevice[];
}

export interface CyncDevice {

  readonly deviceID: number;
  readonly switchID: number;
  readonly displayName: string;
  readonly deviceType: number;
  readonly mac: string;
  readonly firmwareVersion: string;

  meshID: number;

}

interface CyncAuthResponse {

  readonly access_token: string;
  readonly expires_in: number;

}

export class CyncApi {

  private accessToken = '';
  private accessTokenExpires = 0;

  constructor(
    private readonly platform: CyncLightsPlatform,
  ) {
  }

  async getAccessToken() {
    if (!this.platform.config.refreshToken) {
      throw new Error('Please go to the plugin settings and log into Cync.');
    }

    if (this.accessTokenExpires < Date.now()) {
      // first, check the access_token
      this.platform.log.info('Updating access token...');

      const payload = {refresh_token: this.platform.config.refreshToken};
      const token = await fetch('https://api.gelighting.com/v2/user/token/refresh', {
        method: 'post',
        body: JSON.stringify(payload),
        headers: {'Content-Type': 'application/json'},
      });

      const data = await token.json() as CyncAuthResponse;
      if (!data.access_token) {
        this.platform.log.info(`Cync login response: ${JSON.stringify(data)}`);
        throw new Error('Unable to authenticate with Cync servers.  Please verify you have a valid refresh token.');
      }

      this.accessToken = data.access_token;
      // We will refresh it one day before it expires
      this.accessTokenExpires = Date.now() + data.expires_in - 86400;
    } else {
      this.platform.log.info(`Access token valid until ${new Date(this.accessTokenExpires)}`);
    }

    return this.accessToken;
  }

  async forEachDevice(handler: (cyncDevice: CyncDevice, cyncHome: CyncHome) => void) {
    this.platform.log.info('Discovering homes...');

    const accessToken = await this.getAccessToken();
    const options = {
      headers: {'Access-Token': accessToken},
    };

    const r = await fetch(`https://api.gelighting.com/v2/user/${this.platform.config.userID}/subscribe/devices`, options);
    if (r.ok) {
      const data = await r.json() as CyncHome[];
      this.platform.log.debug(`Received home response: ${JSON.stringify(data)}`);

      for (const home of data) {
        const url = `https://api.gelighting.com/v2/product/${home.product_id}/device/${home.id}/property`;
        this.platform.log.debug(`Loading home information from ${url}.`);

        const homeR = await fetch(url, options);
        const homeData = await homeR.json() as CyncHomeDevices;
        this.platform.log.debug(`Received device response: ${JSON.stringify(homeData)}`);
        if (homeData.bulbsArray) {
          for (const device of homeData.bulbsArray) {
            handler(device, home);
          }
        }
      }
    } else {
      this.platform.log.error(`Failed to get home update: ${r.statusText}`);
    }
  }

}