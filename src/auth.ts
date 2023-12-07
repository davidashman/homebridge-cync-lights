import {CyncLightsPlatform} from './platform';
import {StorageService} from 'homebridge/lib/storageService';
import {PLUGIN_NAME} from './settings';
import {CyncAuthInfo, CyncPacketType} from './types'
import {Socket} from 'net';

export class CyncAuth {

  private readonly storage : StorageService;
  private info : CyncAuthInfo;

  constructor(
    private readonly platform: CyncLightsPlatform,
  ) {
    this.storage = new StorageService(this.platform.api.user.storagePath());
    this.storage.initSync();
    this.info = this.storage.getItemSync(`${PLUGIN_NAME}.json`) || {
      refreshToken: '',
      userID: 0,
      authorize: '',
      valid: false,
    };
  }

  async login() {
    // first, check the access_token
    this.platform.log.info(`Authenticating for ${this.platform.config.emailAddress}.`);

    const payload = {
      corp_id: '1007d2ad150c4000',
      email: this.platform.config.emailAddress,
      password: this.platform.config.password,
      two_factor: this.platform.config.mfaCode,
      resource: 'abcdefghijk'
    };
    const response = await fetch('https://api.gelighting.com/v2/user_auth/two_factor', {
      method: 'post',
      body: JSON.stringify(payload),
      headers: {'Content-Type': 'application/json'},
    });

    const data = await response.json();
    this.info = {
      refreshToken: data.refresh_token,
      userID: data.user_id,
      authorize: data.authorize,
      valid: true,
    }

    // save the info
    this.storage.setItemSync(`${PLUGIN_NAME}.json`, this.info);

    return {
      userID: this.info.userID,
      accessToken: data.access_token,
    };
  }

  async requestCode() {
    // first, check the access_token
    this.platform.log.info(`Requesting 2FA code for ${this.platform.config.emailAddress}.`);

    const payload = {
      corp_id: '1007d2ad150c4000',
      email: this.platform.config.emailAddress,
      local_lang: 'en-us'
    };
    await fetch('https://api.gelighting.com/v2/two_factor/email/verifycode', {
      method: 'post',
      body: JSON.stringify(payload),
      headers: {'Content-Type': 'application/json'},
    });

    throw new Error(`Please check your ${this.platform.config.emailAddress} inbox for your 2FA code.`);
  }

  async refreshToken() {
    if (!this.info.valid) {
      if (this.platform.config.mfaCode) {
        return this.login();
      }
      else if (this.platform.config.emailAddress) {
        await this.requestCode();
      }

      throw new Error('Authentication is not valid.  Please go to the settings.');
    }

    // first, check the access_token
    this.platform.log.info('Logging into Cync...');

    const payload = {refresh_token: this.info.refreshToken};
    const token = await fetch('https://api.gelighting.com/v2/user/token/refresh', {
      method: 'post',
      body: JSON.stringify(payload),
      headers: {'Content-Type': 'application/json'},
    });

    const data = await token.json();
    if (!data.access_token) {
      this.platform.log.info(`Cync login response: ${JSON.stringify(data)}`);
      throw new Error('Unable to authenticate with Cync servers.  Please verify you have a valid refresh token.');
    }

    return {
      userID: this.info.userID,
      accessToken: data.access_token,
    };
  }

  authenticate(socket : Socket) {
    this.platform.log.info('Authenticating with Cync servers...');
    const dataLength = this.info.authorize.length + 10;
    const packet = Buffer.alloc(dataLength + 5);
    packet.writeUInt8((CyncPacketType.Auth << 4) | 3);
    packet.writeUInt32BE(dataLength, 1);
    packet.writeUInt8(0x03, 5);
    packet.writeUInt32BE(this.info.userID, 6);
    packet.writeUInt8(this.info.authorize.length, 11);
    packet.write(this.info.authorize, 12, this.info.authorize.length, 'ascii');
    packet.writeUInt8(0xb4, this.info.authorize.length + 14);
    this.platform.log.debug(`Authenticating with packet: ${packet.toString('hex')}`);
    socket.write(packet);
  }

}