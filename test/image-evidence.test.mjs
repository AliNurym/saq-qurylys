import test from 'node:test';
import assert from 'node:assert/strict';
import { crc32,deflateSync } from 'node:zlib';
import { decodeEvidenceImage } from '../src/image-evidence.mjs';

const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
const jpeg='/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==';
function chunk(type,data) {
  const bytes=Buffer.alloc(data.length+12);bytes.writeUInt32BE(data.length);bytes.write(type,4);data.copy(bytes,8);bytes.writeUInt32BE(crc32(bytes.subarray(4,-4)),bytes.length-4);return bytes;
}
function makePng({width=1,height=1,raw=Buffer.from([0,255]),interlace=0}={}) {
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[12]=interlace;
  return Buffer.concat([Buffer.from(png,'base64').subarray(0,8),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]).toString('base64');
}
test('evidence accepts independently generated PNG/JPEG and returns exact bytes, dimensions and digest',()=>{
  for(const [data,mime,width,height] of [[png,'image/png',1,1],[jpeg,'image/jpeg',2,2],[makePng(),'image/png',1,1],[makePng({interlace:1}),'image/png',1,1]]) {
    const result=decodeEvidenceImage(data);assert.equal(result.mime,mime);assert.equal(result.width,width);assert.equal(result.height,height);assert.equal(result.bytes.toString('base64'),data);assert.match(result.sha256,/^[a-f0-9]{64}$/u);
  }
});
test('evidence rejects bad base64, unsupported content, truncation, CRC errors and appended payloads',()=>{
  const badCrc=Buffer.from(png,'base64');badCrc[45]^=1;
  for(const data of ['',null,png+'\n',png.slice(0,-1),'<svg/>',Buffer.from('<svg/>').toString('base64'),badCrc.toString('base64'),Buffer.from(png,'base64').subarray(0,-4).toString('base64'),Buffer.concat([Buffer.from(jpeg,'base64'),Buffer.from('<script>')]).toString('base64'),Buffer.concat([Buffer.from(png,'base64'),Buffer.from('extra')]).toString('base64')])assert.throws(()=>decodeEvidenceImage(data),error=>error.statusCode===400);
});
test('PNG decompression is bounded by dimensions, scanline lengths and allowed filter values',()=>{
  for(const options of [{width:16001},{width:5000,height:5000},{width:0},{raw:Buffer.from([5,1])},{raw:Buffer.from([0])},{raw:Buffer.alloc(1000000)}])assert.throws(()=>decodeEvidenceImage(makePng(options)),error=>error.statusCode===400);
  assert.throws(()=>decodeEvidenceImage(Buffer.alloc(700*1024+1).toString('base64')),error=>error.statusCode===400);
  // A large, alphabetically valid input must fail as a controlled validation error, not a regexp stack overflow.
  assert.throws(()=>decodeEvidenceImage('A'.repeat(900000)),error=>error.statusCode===400);
});
test('JPEG rejects incomplete scan/frame/table structures',()=>{
  const bytes=Buffer.from(jpeg,'base64');
  const noEnd=bytes.subarray(0,-2),badQuantization=Buffer.from(bytes),badFrame=Buffer.from(bytes);
  badQuantization[bytes.indexOf(Buffer.from([255,219]))+4]=255;
  const frame=bytes.indexOf(Buffer.from([255,192]));badFrame.writeUInt16BE(0,frame+5);
  for(const data of [noEnd,badQuantization,badFrame,Buffer.from([255,216,255,217])])assert.throws(()=>decodeEvidenceImage(data.toString('base64')),error=>error.statusCode===400);
});
