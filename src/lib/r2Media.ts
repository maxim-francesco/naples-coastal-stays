// Server-only: this module reads the R2 credentials and signs uploads. The
// marker makes the bundler reject any import from client code.
import "@tanstack/react-start/server-only";

import { MediaError, R2MediaStorage } from "./r2MediaCore";

export const NAPLES_MEDIA_APP_ID = "naples-coastal-stays";
export const NAPLES_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

export function createNaplesMedia(options: Record<string, unknown> = {}) {
  return new R2MediaStorage({
    app: NAPLES_MEDIA_APP_ID,
    maxBytes: NAPLES_IMAGE_MAX_BYTES,
    ...options,
  });
}

const media = createNaplesMedia();

export function propertyMediaPrefix(propertyId: string): string {
  const { config } = media as unknown as { config?: { keyPrefix?: string } };
  const prefix = config?.keyPrefix ? `${config.keyPrefix}/` : "";
  return `${prefix}${NAPLES_MEDIA_APP_ID}/public/${propertyId}`;
}

export async function createPropertyUploadTicket(
  propertyId: string,
  contentType: string,
  byteSize: number,
) {
  return media.createPendingUpload({
    ownerId: propertyId,
    category: "photos",
    mimeType: contentType,
    byteSize,
    visibility: "public",
    maxBytes: NAPLES_IMAGE_MAX_BYTES,
    expiresSeconds: 900,
  });
}

export async function verifyPropertyUpload(propertyId: string, key: string, mimeType: string) {
  return media.verifyUploaded({
    key,
    expectedPrefix: propertyMediaPrefix(propertyId),
    mimeType,
    maxBytes: NAPLES_IMAGE_MAX_BYTES,
  });
}

export async function deletePropertyObject(propertyId: string, key: string) {
  return media.deleteObject(key, propertyMediaPrefix(propertyId));
}

export function managedPropertyKey(value: unknown, propertyId?: string): string | null {
  if (typeof value !== "string" || !value) return null;
  if (value.startsWith("http://") || value.startsWith("https://")) {
    const key = media.keyFromPublicUrl(value);
    if (!key) return null;
    if (propertyId && !key.startsWith(`${propertyMediaPrefix(propertyId)}/`)) return null;
    return key;
  }
  if (propertyId && value.startsWith(`${propertyMediaPrefix(propertyId)}/`)) {
    return value;
  }
  return null;
}

export { MediaError, media as naplesMedia };
