import { u8ToBase64, base64ToU8, mergeChunks, mergeChunksDense, fmtBytes, fmtSpeed, escH } from '../src/renderer/js/utils.js';

describe('Utility Functions', () => {
  describe('Encoding', () => {
    it('should convert Uint8Array to Base64 and back', () => {
      const original = new Uint8Array([72, 101, 108, 108, 111]); // 'Hello'
      const b64 = u8ToBase64(original);
      expect(typeof b64).toBe('string');
      const decoded = base64ToU8(b64);
      expect(decoded).toEqual(original);
    });
  });

  describe('Formatting', () => {
    it('should format bytes correctly', () => {
      expect(fmtBytes(0)).toBe('0 B');
      expect(fmtBytes(500)).toBe('500 B');
      expect(fmtBytes(1024)).toBe('1.0 KB');
      expect(fmtBytes(1048576)).toBe('1.0 MB');
      expect(fmtBytes(1073741824)).toBe('1.00 GB');
    });

    it('should format speed correctly', () => {
      expect(fmtSpeed(500)).toBe('500 B/s');
      expect(fmtSpeed(1024)).toBe('1 KB/s');
      expect(fmtSpeed(1048576)).toBe('1.0 MB/s');
    });
  });

  describe('Security', () => {
    it('should escape HTML characters', () => {
      expect(escH('<script>alert("hi")</script>')).toBe('&lt;script&gt;alert("hi")&lt;/script&gt;');
      expect(escH('Tom & Jerry')).toBe('Tom &amp; Jerry');
    });
  });

  describe('Chunk Merging', () => {
    it('should merge dense chunks correctly', () => {
      const c1 = new Uint8Array([1, 2]);
      const c2 = new Uint8Array([3, 4]);
      const chunks = [c1, c2];
      const merged = mergeChunksDense(chunks, 2);
      expect(merged).toEqual(new Uint8Array([1, 2, 3, 4]));
    });

    it('should merge sparse chunks correctly', () => {
      const c1 = new Uint8Array([1, 2]);
      const c2 = new Uint8Array([3, 4]);
      const chunks = [c1, null, c2];
      const merged = mergeChunks(chunks);
      expect(merged).toEqual(new Uint8Array([1, 2, 3, 4]));
    });
  });
});
