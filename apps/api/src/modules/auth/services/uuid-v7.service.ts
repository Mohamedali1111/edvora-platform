import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

@Injectable()
export class UuidV7Service {
  create(): string {
    const timestamp = BigInt(Date.now());
    const bytes = randomBytes(16);

    bytes[0] = Number((timestamp >> 40n) & 0xffn);
    bytes[1] = Number((timestamp >> 32n) & 0xffn);
    bytes[2] = Number((timestamp >> 24n) & 0xffn);
    bytes[3] = Number((timestamp >> 16n) & 0xffn);
    bytes[4] = Number((timestamp >> 8n) & 0xffn);
    bytes[5] = Number(timestamp & 0xffn);
    bytes[6] = (bytes[6] & 0x0f) | 0x70;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    return [
      bytes.subarray(0, 4).toString('hex'),
      bytes.subarray(4, 6).toString('hex'),
      bytes.subarray(6, 8).toString('hex'),
      bytes.subarray(8, 10).toString('hex'),
      bytes.subarray(10, 16).toString('hex'),
    ].join('-');
  }
}
