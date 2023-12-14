import {PlatformAccessory} from 'homebridge';
import {connect, Socket} from 'net';
import {CyncDevice, CyncHome, CyncPacket, CyncPacketSubtype, CyncPacketType} from './types.js';
import {CyncLight} from './light.js';
import {CyncLightsPlatform} from './platform.js';
import EventEmitter from 'events';

const PING_BUFFER = Buffer.alloc(0);

export class CyncHub {

  private connected = false;
  private connectionTime = 0;
  private socket!: Socket;
  private seq = 0;
  private readonly lights : CyncLight[] = [];
  private readonly queue: CyncPacket[] = [];
  private readonly queueEmitter = new EventEmitter();

  constructor(
    private readonly platform: CyncLightsPlatform,
  ) {
    this.queueEmitter.on('queued', this.processQueue.bind(this));
    this.queueEmitter.on('connected', this.processQueue.bind(this));
    setInterval(this.ping.bind(this), 180000);
  }

  connect() {
    if (!this.connected) {
      this.connectionTime = Date.now();
      this.platform.log.info('Connecting to Cync server...');
      this.socket = connect(23778, 'cm.gelighting.com');
      this.socket.on('readable', this.readPackets.bind(this));
      this.socket.on('end', this.disconnect.bind(this));

      this.platform.log.info('Authenticating with Cync server...');
      const dataLength = this.platform.config.authorize.length + 10;
      const packet = Buffer.alloc(dataLength + 5);
      packet.writeUInt8((CyncPacketType.Auth << 4) | 3);
      packet.writeUInt32BE(dataLength, 1);
      packet.writeUInt8(0x03, 5);
      packet.writeUInt32BE(this.platform.config.userID, 6);
      packet.writeUInt8(this.platform.config.authorize.length, 11);
      packet.write(this.platform.config.authorize, 12, this.platform.config.authorize.length, 'ascii');
      packet.writeUInt8(0xb4, this.platform.config.authorize.length + 14);
      this.platform.log.debug(`Authenticating with packet: ${packet.toString('hex')}`);
      this.socket.write(packet);
    }
  }

  disconnect() {
    this.platform.log.info('Connection to Cync has closed.');
    this.connected = false;

    // Don't allow reconnects in any less than 10 seconds since the last successful connection
    setTimeout(this.connect.bind(this), Math.max(10000 - Date.now() + this.connectionTime, 0));
  }

  handleAuth(packet : CyncPacket) {
    if (packet.data.readUInt16BE() === 0) {
      this.platform.log.info('Cync server connected.');
      this.connected = true;
      this.queueEmitter.emit('connected');
    } else {
      this.connected = false;
      this.platform.log.info('Server authentication failed.');
    }
  }

  writePacket(packet : CyncPacket | undefined) {
    if (packet) {
      this.platform.log.debug(`Sending ${packet.type} packet #${packet.seq}.`);
      this.socket.write(packet.data);
    }
  }

  processQueue() {
    if (this.connected) {
      this.platform.log.debug(`Processing queue of ${this.queue.length} packets.`);
      while (this.queue.length > 0) {
        this.writePacket(this.queue.shift());
      }
    }
  }

  queuePacket(type : CyncPacketType, data : Buffer, isResponse = false) : CyncPacket {
    const packetData = Buffer.alloc(data.length + 5);
    if (isResponse) {
      packetData.writeUInt8((type << 4) | 8);
    } else {
      packetData.writeUInt8((type << 4) | 3);
    }

    if (data.length > 0) {
      packetData.writeUInt32BE(data.length, 1);
      data.copy(packetData, 5);
    }

    const packet = {
      type: type,
      seq: this.readPacketSeq(type, data),
      isResponse: isResponse,
      length: packetData.length,
      data: packetData,
    };

    this.platform.log.debug(`Queuing ${type} packet #${packet.seq}.`);
    // queue the packet
    this.queue.push(packet);
    this.queueEmitter.emit('queued');

    return packet;
  }

  queueDevicePacket(device : CyncDevice, type : CyncPacketType, subtype : CyncPacketSubtype, deviceData : Buffer) : CyncPacket {
    const data = Buffer.alloc(18 + deviceData.length);
    data.writeUInt32BE(device.switchID);
    data.writeUInt16BE(this.seq++, 4);
    data.writeUInt8(0x7e, 7);
    data.writeUInt8(0xf8, 12);
    data.writeUInt8(subtype, 13); // status query subtype
    data.writeUInt8(deviceData.length, 14);
    deviceData.copy(data, 18);

    return this.queuePacket(type, data);
  }

  acknowledgePacket(packet : CyncPacket) {
    this.platform.log.debug(`Acknowledging packet ${packet.seq}.`);
    this.queuePacket(packet.type, packet.data.subarray(0, 7), true);
  }

  readPackets() {
    let packet = this.readPacket();
    while (packet) {
      // this.printPacket(packet);
      switch (packet.type) {
        case CyncPacketType.Auth:
          this.handleAuth(packet);
          break;
        case CyncPacketType.Sync:
          this.handleSync(packet);
          break;
        case CyncPacketType.Status:
          this.handleStatus(packet);
          break;
        // case CyncPacketType.StatusSync:
        //   this.handleStatusSync(packet);
        //   break;
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
            seq: this.readPacketSeq(type, data),
            isResponse: (header.readUInt8() & 8) !== 0,
            length: length,
            data: data,
          };
        } else {
          this.platform.log.info('Packet length does not match.');
        }
      }
    }

    return null;
  }

  readPacketSeq(type : CyncPacketType, data : Buffer) {
    if (type === CyncPacketType.Sync || type === CyncPacketType.Status || type === CyncPacketType.Connection) {
      return data.readUInt16BE(4);
    }

    return null;
  }

  ping() {
    this.queuePacket(CyncPacketType.Ping, PING_BUFFER);
  }

  updateConection(device : CyncDevice) {
    // Ask the server if each device is connected
    const data = Buffer.alloc(7);
    data.writeUInt32BE(device.switchID);
    data.writeUInt16BE(this.seq++, 4);
    this.queuePacket(CyncPacketType.Connection, data);

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
    this.queueDevicePacket(device, CyncPacketType.Status, CyncPacketSubtype.Paginated, data);
  }

  handleStatus(packet : CyncPacket) {
    if (!packet.isResponse) {
      this.acknowledgePacket(packet);
    }

    if (packet.length >= 25) {
      const subtype = packet.data.readUInt8(13);
      switch (subtype) {
        // case CyncPacketSubtype.Get:
        //   this.handleStatusUpdate(packet.data);
        //   break;
        case CyncPacketSubtype.Paginated:
          for (let offset = 22; offset + 24 <= packet.data.length; offset += 24) {
            this.handlePaginatedStatusUpdate(packet.data.subarray(offset, offset + 24));
          }
      }
    }
    // this.log.info(`Received status packet of length ${packet.length}: ${packet.data.toString('hex')}`);
  }

  // handleStatusUpdate(status) {
  //   this.platform.log.debug(`Status packet: ${status.toString('hex')}`);
  //   const meshID = status.readUInt8(21);
  //   const on = status.readUInt8(27) > 0;
  //   const brightness = on ? status.readUInt8(28) : 0;
  //   this.lights.find(light => light.device.meshID === meshID)?.updateState(on, brightness);
  // }

  handlePaginatedStatusUpdate(status) {
    this.platform.log.debug(`Paginated Status packet: ${status.toString('hex')}`);
    const meshID = status.readUInt8();
    const on = status.readUInt8(8) > 0;
    const brightness = on ? status.readUInt8(12) : 0;
    const colorTemp = status.readUInt8(16);
    const rgb = [status.readUInt8(20), status.readUInt8(21), status.readUInt8(22)];
    this.lights.find(light => light.device.meshID === meshID)?.updateState(on, brightness, colorTemp, rgb);
  }

  handleSync(packet) {
    for (let offset = 7; offset + 19 <= packet.data.length; offset += 19) {
      this.handleSyncStatus(packet.data.subarray(offset, offset + 19));
    }
  }

  handleSyncStatus(status) {
    this.platform.log.debug(`Sync packet: ${status.toString('hex')}`);
    const meshID = status.readUInt8(3);
    const on = status.readUInt8(4) > 0;
    const brightness = on ? status.readUInt8(5) : 0;
    const colorTemp = status.readUInt8(6);
    this.lights.find(light => light.device.meshID === meshID)?.updateState(on, brightness, colorTemp);
  }

  // handleStatusSync(packet) {
  //   if (packet.length >= 33) {
  //     this.platform.log.debug(`Sync packet: ${packet.toString('hex')}`);
  //     const meshID = packet.data.readUInt8(21);
  //     const on = packet.data.readUInt8(27) > 0;
  //     const brightness = on ? packet.data.readUInt8(28) : 0;
  //     this.lights.find(light => light.device.meshID === meshID)?.updateState(on, brightness);
  //   }
  // }

  registerDevice(accessory : PlatformAccessory, device : CyncDevice, home : CyncHome) {
    const existingLight = this.lights.find((light) => light.accessory.UUID === accessory.UUID);
    if (existingLight) {
      this.platform.log.debug(`Device ${accessory.displayName} (${accessory.UUID}) is already registered.`);
      return existingLight;
    } else {
      this.platform.log.info(`Registering device: ${JSON.stringify(device)}`);
      const light = new CyncLight(this.platform, accessory, this, device, home);
      this.lights.push(light);
      this.updateConection(device);
      return light;
    }
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