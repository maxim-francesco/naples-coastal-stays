import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Expand } from "lucide-react";

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
            <img
              src={photo.src}
              alt={photo.alt}
              loading={i === 0 ? "eager" : "lazy"}
              width={1600}
              height={1104}
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
          {active !== null && (
            <img
              src={photos[active].src}
              alt={photos[active].alt}
              className="max-h-[80vh] w-full object-contain bg-foreground/5"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
