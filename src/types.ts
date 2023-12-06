export interface CyncHome {

  readonly id: number;

}

export interface CyncDevice {

  readonly deviceID: number;
  readonly switchID: number;
  readonly displayName: string;

  meshID: number;

}

export enum CyncPacketType {
  Auth = 1,
  Sync = 4,
  Status = 7,
  StatusSync = 8,
  Connection = 10,
  Ping = 13
}

export enum CyncPacketSubtype {
  Set = 0xf0,
  Get = 0xdb,
  Paginated = 0x52
}

export interface CyncPacket {

  readonly type: CyncPacketType;
  readonly length: number;
  readonly isResponse: boolean;
  readonly data: Buffer;

}
