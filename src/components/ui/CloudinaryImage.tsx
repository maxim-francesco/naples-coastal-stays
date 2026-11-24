import {
  isCloudinaryUrl,
  cloudinaryUrl,
  cloudinarySrcSet,
  type CloudinaryOptions,
} from "@/lib/cloudinary";
import { PHOTO_VARIANT_WIDTHS, parseR2PhotoUrl, photoVariantSrcSet } from "@/lib/responsiveImage";

export interface PictureSource {
  media: string;
  aspectRatio?: string;
  widths?: number[];
  sizes?: string;
}

export interface CloudinaryImageProps extends CloudinaryOptions {
  src: string;
  alt: string;
  widths?: number[];
  sizes?: string;
  priority?: boolean;
  className?: string;
  width?: number;
  height?: number;
  pictureSources?: PictureSource[] | undefined;
}

// Renders property photos from either storage provider with the same component.
// A Cloudinary URL gets responsive, cropped variants through `srcset`. An R2
// photo URL carries the original's pixel width in its file name, so the same
// `widths` prop produces a `srcset` of pre-generated WebP files that are never
// wider than the source. The original JPG remains the fallback. Anything else
// is rendered exactly as stored.
export function CloudinaryImage({
  src,
  alt,
  widths,
  sizes,
  priority = false,
  className,
  width,
  height,
  aspectRatio,
  crop,
  gravity,
  quality,
  format,
  pictureSources,
}: CloudinaryImageProps) {
  const isCloudinary = isCloudinaryUrl(src);
  const isR2Photo = !isCloudinary && parseR2PhotoUrl(src) !== null;

  let finalSrc = src;
  let finalSrcSet: string | undefined = undefined;

  if (isCloudinary) {
    const opts: CloudinaryOptions = { aspectRatio, crop, gravity, quality, format };
    if (widths && widths.length > 0) {
      const smallestWidth = Math.min(...widths);
      finalSrc = cloudinaryUrl(src, { ...opts, width: smallestWidth });
      finalSrcSet = cloudinarySrcSet(src, widths, opts) || undefined;
    } else if (width) {
      finalSrc = cloudinaryUrl(src, { ...opts, width });
    } else {
      finalSrc = cloudinaryUrl(src, opts);
    }
  } else if (isR2Photo && (sizes || (widths && widths.length > 0))) {
    finalSrcSet = photoVariantSrcSet(src, widths ?? PHOTO_VARIANT_WIDTHS) || undefined;
  }

  const loading = priority ? "eager" : "lazy";
  const fetchPriority = priority ? "high" : "auto";
  const hasSrcSet = Boolean(finalSrcSet);

  // Extra sources exist for both providers: Cloudinary builds cropped variants,
  // R2 reuses the width-limited WebP set. Without the <picture> wrapper the
  // caller's classes belong on the image itself, or it loses its layout box.
  const usePicture = (isCloudinary || isR2Photo) && !!pictureSources && pictureSources.length > 0;

  const imgElement = (
    <img
      src={finalSrc}
      alt={alt}
      srcSet={finalSrcSet}
      sizes={hasSrcSet ? sizes : undefined}
      width={width}
      height={height}
      loading={loading}
      fetchPriority={fetchPriority}
      decoding="async"
      className={usePicture ? "h-full w-full object-cover" : className}
    />
  );

  if (usePicture) {
    return (
      <picture className={className}>
        {pictureSources.map((source, idx) => {
          const sOpts: CloudinaryOptions = {
            aspectRatio: source.aspectRatio ?? aspectRatio,
            crop,
            gravity,
            quality,
            format,
          };
          const sWidths = source.widths ?? widths;
          const sSrcSet = isCloudinary
            ? sWidths
              ? cloudinarySrcSet(src, sWidths, sOpts)
              : undefined
            : photoVariantSrcSet(src, sWidths ?? PHOTO_VARIANT_WIDTHS) || undefined;
          return (
            <source key={idx} media={source.media} srcSet={sSrcSet} sizes={source.sizes ?? sizes} />
          );
        })}
        {imgElement}
      </picture>
    );
  }

  return imgElement;
}
