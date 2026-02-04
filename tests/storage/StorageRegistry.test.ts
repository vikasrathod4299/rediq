import { getStorage, clearMemoryStorageRegistry } from '../../src/storage/StorageRegistery';
import { MemoryStorageAdapter } from '../../src/storage/MemoryStorageAdapter';

describe('StorageRegistry', () => {
  beforeEach(() => {
    clearMemoryStorageRegistry();
  });

  describe('getStorage', () => {
    it('should return same instance for same queue name (in-memory)', () => {
      const storage1 = getStorage('test-queue');
      const storage2 = getStorage('test-queue');

      expect(storage1).toBe(storage2); // Same reference
    });

    it('should return different instances for different queue names', () => {
      const storage1 = getStorage('queue-1');
      const storage2 = getStorage('queue-2');

      expect(storage1).not.toBe(storage2);
    });

    it('should return MemoryStorageAdapter when no redis config', () => {
      const storage = getStorage('test-queue');
      expect(storage).toBeInstanceOf(MemoryStorageAdapter);
    });
  });

  describe('clearStorageRegistry', () => {
    it('should clear all cached instances', () => {
      const storage1 = getStorage('test-queue');
      clearMemoryStorageRegistry();
      const storage2 = getStorage('test-queue');

      expect(storage1).not.toBe(storage2); // Different references after clear
    });
  });
});