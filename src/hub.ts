import {PlatformAccessory} from 'homebridge';
import {connect, Socket} from 'net';
import {CyncDevice, CyncHome, CyncPacket, CyncPacketSubtype, CyncPacketType} from './types';
import {CyncLight} from './light';
import {CyncLightsPlatform} from './platform';

const PING_BUFFER = Buffer.alloc(0);

export class CyncHub {

  private connected = false;
  private connectionTime = 0;
  private socket: Socket;
  private readonly queue: CyncPacket[] = [];
  private seq = 0;
  private readonly lights : CyncLight[] = [];

  constructor(
    private readonly platform: CyncLightsPlatform,
  ) {
    this.socket = this.connect();
    setInterval(this.ping.bind(this), 180000);
  }

  connect(): Socket {
    this.platform.log.info('Connecting to Cync servers...');
    const socket = connect(23778, 'cm.gelighting.com');
    socket.on('readable', this.readPackets.bind(this));
    socket.on('end', this.disconnect.bind(this));

    const data = Buffer.alloc(this.platform.config.authorize.length + 10);
    data.writeUInt8(0x03);
    data.writeUInt32BE(this.platform.config.userID, 1);
    data.writeUInt8(this.platform.config.authorize.length, 6);
    data.write(this.platform.config.authorize, 7, this.platform.config.authorize.length, 'ascii');
    data.writeUInt8(0xb4, this.platform.config.authorize.length + 9);
    socket.write(this.createPacket(CyncPacketType.Auth, data).data);

    return socket;
  }

  disconnect() {
    this.platform.log.info('Connection to Cync has closed.');
    this.connected = false;

    // Don't allow reconnects in any less than 10 seconds since the last successful connection
    setTimeout(() => this.socket = this.connect(), Math.max(10000 - Date.now() + this.connectionTime, 0));
  }

  handleConnect(packet : CyncPacket) {
    if (packet.data.readUInt16BE() === 0) {
      this.platform.log.info('Cync server connected.');
      this.flushQueue();
      this.connected = true;
      this.connectionTime = Date.now();
    } else {
      this.connected = false;
      this.platform.log.info('Server authentication failed.');
    }
  }

  ping() {
    if (this.connected) {
      this.writePacket(this.createPacket(CyncPacketType.Ping, PING_BUFFER));
    }
  }

  flushQueue() {
    this.platform.log.info(`Flushing queue of ${this.queue.length} packets.`);
    while (this.queue.length > 0) {
      this.writePacket(this.queue.shift());
    }
  }

  writePacket(packet : CyncPacket | undefined) {
    if (packet) {
      this.socket.write(packet.data);
    }
  }

  sendPacket(packet : CyncPacket, log = false) {
    if (this.connected) {
      if (log) {
        this.platform.log.debug(`Sending packet: ${packet.data.toString('hex')}`);
      }

      this.writePacket(packet);
    } else {
      if (log) {
        this.platform.log.debug(`Queueing packet: ${packet.data.toString('hex')}`);
      }

      // queue the packet
      this.queue.push(packet);
    }
  }

  createPacket(type : CyncPacketType, data : Buffer) : CyncPacket {
    const packet = Buffer.alloc(data.length + 5);
    packet.writeUInt8((type << 4) | 3);

    if (data.length > 0) {
      packet.writeUInt32BE(data.length, 1);
      data.copy(packet, 5);
    }

    return {
      type: type,
      isResponse: false,
      length: packet.length,
      data: packet,
    };
  }

  createDevicePacket(device : CyncDevice, type : CyncPacketType, subtype : CyncPacketSubtype, deviceData : Buffer) : CyncPacket {
    const data = Buffer.alloc(18 + deviceData.length);
    data.writeUInt32BE(device.switchID);
    data.writeUInt16BE(this.seq++, 4);
    data.writeUInt8(0x7e, 7);
    data.writeUInt8(0xf8, 12);
    data.writeUInt8(subtype, 13); // status query subtype
    data.writeUInt8(deviceData.length, 14);
    deviceData.copy(data, 18);

    return this.createPacket(type, data);
  }

  readPackets() {
    let packet = this.readPacket();
    while (packet) {
      // this.printPacket(packet);
      switch (packet.type) {
        case CyncPacketType.Auth:
          this.handleConnect(packet);
          break;
        case CyncPacketType.Status:
          this.handleStatus(packet);
          break;
        case CyncPacketType.Sync:
          this.handleSync(packet);
          break;
        case CyncPacketType.StatusSync:
          this.handleStatusSync(packet);
          break;
        case CyncPacketType.Connection:
          this.handleConnection(packet);
          break;
      }

      packet = this.readPacket();
    }
  }

  readPacket() : CyncPacket | null {
    // First read the header
    const header = this.socket.read(5);
    if (header) {
      const type = (header.readUInt8() >>> 4);
      const length = header.readUInt32BE(1);
      this.platform.log.debug(`Got packet header with type ${type}, header ${header.toString('hex')}, length ${length}`);

      if (length > 0) {
        const data = this.socket.read(length);

        if (data.length === length) {
          return {
            type: type,
            length: length,
            isResponse: (header.readUInt8() & 8) !== 0,
            data: data,
          };
        } else {
          this.platform.log.info('Packet length does not match.');
        }
      }
    }

    return null;
  }

  updateConection(device : CyncDevice) {
    // Ask the server if each device is connected
    const data = Buffer.alloc(7);
    data.writeUInt32BE(device.switchID);
    data.writeUInt16BE(this.seq++, 4);
    this.sendPacket(this.createPacket(CyncPacketType.Connection, data), true);

    // check again in 5 minutes
    setTimeout(() => {
      this.updateConection(device);
    }, 300000);
  }

  updateStatus(device : CyncDevice) {
    const data = Buffer.alloc(6);
    data.writeUInt16BE(0xffff);
    data.writeUInt8(0x56, 4);
    data.writeUInt8(0x7e, 5);
    this.sendPacket(this.createDevicePacket(device, CyncPacketType.Status, CyncPacketSubtype.Paginated, data), false);
  }

  handleStatus(packet : CyncPacket) {
    const switchID = packet.data.readUInt32BE();
    const responseID = packet.data.readUInt16BE(4);

    if (!packet.isResponse) {
      // send a response
      const data = Buffer.alloc(7);
      data.writeUInt32BE(switchID);
      data.writeUInt16BE(responseID, 4);
      this.sendPacket(this.createPacket(CyncPacketType.Status, data), false);
    }

    if (packet.length >= 25) {
      const subtype = packet.data.readUInt8(13);
      let status = packet.data;
      switch (subtype) {
        case CyncPacketSubtype.Get:
          this.handleStatusUpdate(status);
          break;
        case CyncPacketSubtype.Paginated:
          status = status.subarray(22);
          while (status.length > 24) {
            this.handlePaginatedStatusUpdate(status);
            status = status.subarray(24);
            break;
          }
      }
    }
    // this.log.info(`Received status packet of length ${packet.length}: ${packet.data.toString('hex')}`);
  }

  handleStatusUpdate(status) {
    const meshID = status.readUInt8(21);
    const on = status.readUInt8(27) > 0;
    const brightness = on ? status.readUInt8(28) : 0;
    this.lights.find(light => light.device.meshID === meshID)?.updateState(on, brightness);
  }

  handlePaginatedStatusUpdate(status) {
    const meshID = status.readUInt8();
    const on = status.readUInt8(8) > 0;
    const brightness = on ? status.readUInt8(12) : 0;
    const colorTemp = status.readUInt8(16);
    const rgb = [status.readUInt8(20), status.readUInt8(21), status.readUInt8(22)];
    this.lights.find(light => light.device.meshID === meshID)?.updateState(on, brightness, colorTemp, rgb);
  }

  handleSync(packet) {
    const data = packet.data.subarray(7);

    for (let offset = 0; offset < data.length; offset += 19) {
      const status = data.subarray(offset, offset + 19);
      const meshID = status.readUInt8(3);
      const on = status.readUInt8(4) > 0;
      const brightness = on ? status.readUInt8(5) : 0;
      const colorTemp = status.readUInt8(6);
      this.lights.find(light => light.device.meshID === meshID)?.updateState(on, brightness, colorTemp);
    }
  }

  handleStatusSync(packet) {
    if (packet.length >= 33) {
      const meshID = packet.data.readUInt8(21);
      const on = packet.data.readUInt8(27) > 0;
      const brightness = on ? packet.data.readUInt8(28) : 0;
      this.lights.find(light => light.device.meshID === meshID)?.updateState(on, brightness);
    }
  }

  registerDevice(accessory : PlatformAccessory, device : CyncDevice, home : CyncHome) {
    const light = new CyncLight(this.platform, accessory, this, device, home);
    this.lights.push(light);
    this.updateConection(device);
    return light;
  }

  handleConnection(packet : CyncPacket) {
    const switchID = packet.data.readUInt32BE();
    const light = this.lights.find(light => light.device.switchID === switchID);
    if (light) {
      setTimeout(() => {
        this.updateStatus(light.device);
      });
    }
  }

}