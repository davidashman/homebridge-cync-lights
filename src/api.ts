import fetch from 'node-fetch';
import {CyncLightsPlatform} from './platform.js';
import path from 'node:path';
import fs from 'node:fs';

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

interface CyncLoginResponse {

  readonly refresh_token: string;
  readonly user_id: number;
  readonly authorize: string;

}

export class CyncApi {

  private accessToken = '';
  private accessTokenExpires = 0;
  private readonly refreshToken : string;
  public readonly userID : number;
  public readonly authorize : string;

  constructor(
    private readonly platform: CyncLightsPlatform,
  ) {
    const identity = this.loadIdentity();
    this.platform.log.info(`Identity: ${JSON.stringify(identity)}`);
    this.refreshToken = identity.refresh_token;
    this.userID = identity.user_id;
    this.authorize = identity.authorize;
  }

  loadIdentity() : CyncLoginResponse {
    const identityFile = path.join(this.platform.api.user.storagePath(), 'cync.json');
    this.platform.log.info(`Identity file: ${identityFile}`);
    if (fs.existsSync(identityFile)) {
      this.platform.log.info(`Returning contents of ${identityFile}`);
      return JSON.parse(fs.readFileSync(identityFile, 'utf-8'));
    } else {
      // First time running this version, so move the config over
      const identity = {
        refresh_token: this.platform.config.refreshToken,
        user_id: this.platform.config.userID,
        authorize: this.platform.config.authorize,
      };
      this.platform.log.info(`Creating identity file ${identityFile} with ${JSON.stringify(identity)}`);
      fs.writeFileSync(identityFile, JSON.stringify(identity), 'utf-8');
      return identity;
    }
  }

  async getAccessToken() {
    if (!this.refreshToken) {
      throw new Error('Please go to the plugin settings and log into Cync.');
    }

    if (this.accessTokenExpires < Date.now()) {
      // first, check the access_token
      this.platform.log.info('Updating access token...');

      const payload = {refresh_token: this.refreshToken};
      this.platform.log.info(`Payload: ${JSON.stringify(payload)}`);
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

    const r = await fetch(`https://api.gelighting.com/v2/user/${this.userID}/subscribe/devices`, options);
    if (r.ok) {
      const data = await r.json() as CyncHome[];
      this.platform.log.info(`Received home response: ${JSON.stringify(data)}`);

      for (const home of data) {
        const url = `https://api.gelighting.com/v2/product/${home.product_id}/device/${home.id}/property`;
        this.platform.log.info(`Loading home information from ${url}.`);

        const homeR = await fetch(url, options);
        const homeData = await homeR.json() as CyncHomeDevices;
        this.platform.log.info(`Received device response: ${JSON.stringify(homeData)}`);
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