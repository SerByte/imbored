import type { MetadataRoute } from 'next'
import { manifestFor } from '@/lib/manifest'

/**
 * Русский манифест — /manifest.webmanifest. Что в нём и почему, и где
 * английский двойник, — в lib/manifest.ts.
 */
export default function manifest(): MetadataRoute.Manifest {
  return manifestFor('ru')
}
