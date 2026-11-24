export interface CloudinaryOptions {
  width?: number | undefined;
  height?: number | undefined;
  aspectRatio?: string | undefined;
  crop?: string | undefined;
  gravity?: string | undefined;
  quality?: string | undefined;
  format?: string | undefined;
}

export function isCloudinaryUrl(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  return url.includes("res.cloudinary.com") && url.includes("/image/upload/");
}

export function cloudinaryUrl(url: string, opts: CloudinaryOptions = {}): string {
  if (!isCloudinaryUrl(url)) return url;

  const uploadStr = "/image/upload/";
  const uploadIndex = url.indexOf(uploadStr);
  if (uploadIndex === -1) return url;

  const prefix = url.slice(0, uploadIndex + uploadStr.length);
  const rest = url.slice(uploadIndex + uploadStr.length);

  const firstSlashIndex = rest.indexOf("/");
  const firstSegment = firstSlashIndex === -1 ? rest : rest.slice(0, firstSlashIndex);

  // Check if first segment is already a transformation segment (e.g. c_fill,f_auto,q_auto,w_800)
  // Version segment starts with v followed by numbers (e.g. v1786449598).
  const isTransformation =
    /^(?:[a-z]{1,3}_[^/,]+)(?:,[a-z]{1,3}_[^/,]+)*$/i.test(firstSegment) &&
    !/^v\d+$/i.test(firstSegment);

  if (isTransformation) {
    return url;
  }

  const params: string[] = [];

  if (opts.aspectRatio) {
    params.push(`ar_${opts.aspectRatio}`);
  }

  let crop = opts.crop || "limit";
  if (crop === "fill" && !opts.aspectRatio && !opts.height) {
    crop = "limit";
  }

  if (crop) {
    params.push(`c_${crop}`);
  }

  const format = opts.format || "auto";
  if (format) params.push(`f_${format}`);

  if (opts.gravity) params.push(`g_${opts.gravity}`);
  if (opts.height) params.push(`h_${opts.height}`);

  const quality = opts.quality || "auto";
  if (quality) params.push(`q_${quality}`);

  if (opts.width) params.push(`w_${opts.width}`);

  const transformSegment = params.join(",");

  return `${prefix}${transformSegment}/${rest}`;
}

export function cloudinarySrcSet(
  url: string,
  widths: number[],
  opts: CloudinaryOptions = {},
): string {
  if (!isCloudinaryUrl(url) || !widths || widths.length === 0) {
    return "";
  }

  return widths.map((w) => `${cloudinaryUrl(url, { ...opts, width: w })} ${w}w`).join(", ");
}
