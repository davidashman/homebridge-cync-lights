
export interface CyncHome {

  readonly id: number;
  readonly product_id: string;

}

export interface CyncHomeDevices {

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

export enum CyncPacketType {
  Auth = 1,
  Sync = 4,
  Status = 7,
  Connection = 10,
  Ping = 13,
}

export enum CyncPacketSubtype {
  SetOn = 0xd0,
  SetState = 0xf0,
  Get = 0xdb,
  Paginated = 0x52
}

export interface CyncPacket {

  readonly type: CyncPacketType;
  readonly seq: number | null;
  readonly length: number;
  readonly isResponse: boolean;
  readonly data: Buffer;

}

export interface CyncAuthResponse {

  readonly access_token: string;
  readonly expires_in: number;

}
