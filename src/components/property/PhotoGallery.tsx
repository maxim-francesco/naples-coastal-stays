import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Expand } from "lucide-react";
import { CloudinaryImage } from "@/components/ui/CloudinaryImage";

type Photo = { src: string; alt: string };

export function PhotoGallery({ photos, title }: { photos: Photo[]; title: string }) {
  const [active, setActive] = useState<number | null>(null);

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-4 sm:grid-rows-2">
        {photos.map((photo, i) => (
          <button
            key={photo.src}
            type="button"
            onClick={() => setActive(i)}
            className={`group relative overflow-hidden rounded-2xl bg-sand ${
              i === 0 ? "sm:col-span-2 sm:row-span-2" : "sm:col-span-2"
            }`}
          >
            <CloudinaryImage
              src={photo.src}
              alt={photo.alt}
              priority={i === 0}
              widths={[350, 447, 538, 700, 1076]}
              sizes="(min-width: 640px) 538px, 447px"
              aspectRatio="3:2"
              crop="fill"
              gravity="auto"
              width={1600}
              height={1104}
              pictureSources={
                i === 0
                  ? [
                      {
                        media: "(min-width: 640px)",
                        aspectRatio: "3:4",
                        widths: [350, 447, 538, 700, 1076],
                        sizes: "538px",
                      },
                    ]
                  : undefined
              }
              className="h-56 w-full object-cover transition-transform duration-700 group-hover:scale-[1.04] sm:h-full"
            />
            <span className="absolute right-3 bottom-3 rounded-full bg-background/85 p-2 opacity-0 transition-opacity group-hover:opacity-100">
              <Expand className="size-4" />
            </span>
          </button>
        ))}
      </div>

      <Dialog open={active !== null} onOpenChange={() => setActive(null)}>
        <DialogContent className="max-w-4xl overflow-hidden rounded-2xl p-0">
          <DialogTitle className="sr-only">{title} photos</DialogTitle>
          {active !== null && photos[active] && (
            <CloudinaryImage
              src={photos[active]!.src}
              alt={photos[active]!.alt}
              width={1600}
              crop="limit"
              className="max-h-[80vh] w-full object-contain bg-foreground/5"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
