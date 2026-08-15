import {
  isCloudinaryUrl,
  cloudinaryUrl,
  cloudinarySrcSet,
  type CloudinaryOptions,
} from "@/lib/cloudinary";

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
  pictureSources?: PictureSource[];
}

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
  }

  const loading = priority ? "eager" : "lazy";
  const fetchPriority = priority ? "high" : "auto";

  const imgElement = (
    <img
      src={finalSrc}
      alt={alt}
      srcSet={finalSrcSet}
      sizes={isCloudinary && finalSrcSet ? sizes : undefined}
      width={width}
      height={height}
      loading={loading}
      fetchPriority={fetchPriority}
      decoding="async"
      className={pictureSources && pictureSources.length > 0 ? "h-full w-full object-cover" : className}
    />
  );

  if (pictureSources && pictureSources.length > 0 && isCloudinary) {
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
          const sSrcSet = sWidths ? cloudinarySrcSet(src, sWidths, sOpts) : undefined;
          return (
            <source
              key={idx}
              media={source.media}
              srcSet={sSrcSet}
              sizes={source.sizes}
            />
          );
        })}
        {imgElement}
      </picture>
    );
  }

  return imgElement;
}
