import type { Session } from '@oasp/schemas';

/**
 * Derives a stable string key for one mounted resource, used by the
 * mock provider's resource-mount-count tracking (see
 * {@link import('./mock-provider-controls.types').MockProviderControls.getResourceMountCount}).
 * Keys are namespaced by resource `type` so a `file` and a
 * `memory_store` never collide even if their opaque ids happened to
 * match. For `github_repository`, the optional `ref` is part of the key
 * — the same repo mounted at two different refs is two distinct mounts,
 * so collapsing them would miscount. A missing `ref` uses the sentinel
 * `~default`; `~` is forbidden in git ref names, so the sentinel can
 * never collide with a real ref.
 */
export function resourceMountKey(resource: Session['resources'][number]): string {
  switch (resource.type) {
    case 'file':
      return `file:${resource.fileId}`;
    case 'memory_store':
      return `memory_store:${resource.storeId}`;
    case 'github_repository':
      return `github_repository:${resource.owner}/${resource.repo}@${resource.ref ?? '~default'}`;
  }
}
