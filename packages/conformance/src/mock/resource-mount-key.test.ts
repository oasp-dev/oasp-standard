import { describe, expect, it } from 'vitest';
import { resourceMountKey } from './resource-mount-key';

describe('resourceMountKey', () => {
  it('derives a namespaced key for a file resource', () => {
    expect(resourceMountKey({ type: 'file', fileId: 'file_1' })).toBe('file:file_1');
  });

  it('derives a namespaced key for a memory_store resource', () => {
    expect(resourceMountKey({ type: 'memory_store', storeId: 'store_1' })).toBe('memory_store:store_1');
  });

  it('derives a namespaced key for a github_repository resource', () => {
    expect(resourceMountKey({ type: 'github_repository', owner: 'acme', repo: 'widgets' })).toBe(
      'github_repository:acme/widgets',
    );
  });

  it('does not collide across types even with overlapping ids', () => {
    const fileKey = resourceMountKey({ type: 'file', fileId: 'x' });
    const storeKey = resourceMountKey({ type: 'memory_store', storeId: 'x' });
    expect(fileKey).not.toBe(storeKey);
  });
});
