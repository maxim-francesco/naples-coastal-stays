import React, { useState, useEffect, useRef } from "react";
import {
  listPropertyPhotos,
  getUploadTicket,
  savePropertyPhoto,
  deletePropertyPhoto,
  setCoverPhoto,
  reorderPhotos,
  type DBPhoto,
  type PhotoStorageOutcome,
} from "@/lib/adminPhotos.server";
import {
  Loader2,
  X,
  Image as ImageIcon,
  ArrowUp,
  ArrowDown,
  Trash2,
  Star,
  UploadCloud,
} from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

interface PhotoManagerDialogProps {
  isOpen: boolean;
  onClose: () => void;
  propertyId: string;
  propertyName: string;
  accessToken?: string;
}

interface UploadStatus {
  id: string;
  fileName: string;
  status: "signing" | "uploading" | "saving" | "done" | "error";
  error?: string | undefined;
}

// Must stay in step with the types the server accepts.
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

// What the administrator is told after a photo is removed, depending on what
// happened to its stored file.
const REMOVED_MESSAGES: Record<PhotoStorageOutcome, { kind: "success" | "warning"; text: string }> =
  {
    deleted: { kind: "success", text: "Photo deleted." },
    none: { kind: "success", text: "Photo deleted." },
    "legacy-kept": {
      kind: "success",
      text: "Photo removed from the site. Its original is kept in the previous storage until the photo migration is finalized.",
    },
    "shared-kept": {
      kind: "success",
      text: "Photo removed. Its file is still used by another photo and was kept.",
    },
    "cleanup-pending": {
      kind: "warning",
      text: "Photo removed from the site, but its file could not be deleted from storage yet.",
    },
  };

// Turns a failed transfer into something an administrator can act on.
function describeUploadFailure(status: number): string {
  if (status === 0) {
    return "The browser blocked the upload before it reached storage. Check that the storage bucket allows this site (CORS).";
  }
  if (status === 403) {
    return "Storage rejected the upload link (HTTP 403). It may have expired — please try again.";
  }
  return `Storage rejected the upload (HTTP ${status}).`;
}

export function PhotoManagerDialog({
  isOpen,
  onClose,
  propertyId,
  propertyName,
  accessToken,
}: PhotoManagerDialogProps) {
  const [photos, setPhotos] = useState<DBPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionInProgress, setActionInProgress] = useState(false);
  const [uploads, setUploads] = useState<UploadStatus[]>([]);
  const [progress, setProgress] = useState(0);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch photos on open or when propertyId changes
  const fetchPhotos = async () => {
    if (!propertyId) return;
    setLoading(true);
    try {
      const data = await listPropertyPhotos({
        data: { propertyId },
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      setPhotos(data);
    } catch (e) {
      console.error("Failed to load photos:", e);
      toast.error("Failed to load photos.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && propertyId) {
      fetchPhotos();
      setUploads([]);
    }
  }, [isOpen, propertyId]);

  // Set Cover Photo
  const handleSetCover = async (photoId: string) => {
    setActionInProgress(true);
    try {
      const res = await setCoverPhoto({
        data: { id: photoId, propertyId },
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        toast.success("Cover photo updated.");
        await fetchPhotos();
      } else {
        toast.error(res.error || "Failed to update cover photo.");
      }
    } catch (e) {
      console.error(e);
      toast.error(messageOf(e, "An error occurred."));
    } finally {
      setActionInProgress(false);
    }
  };

  // Reorder Photos
  const handleMove = async (currentIndex: number, direction: "up" | "down") => {
    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= photos.length) return;

    setActionInProgress(true);
    try {
      const reordered = [...photos];
      const temp = reordered[currentIndex];
      if (temp && reordered[targetIndex]) {
        reordered[currentIndex] = reordered[targetIndex];
        reordered[targetIndex] = temp;
      }

      const orderedIds = reordered.map((p) => p.id);

      const res = await reorderPhotos({
        data: { propertyId, orderedIds },
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (res.ok) {
        setPhotos(reordered);
      } else {
        toast.error(res.error || "Failed to update photo order.");
        await fetchPhotos();
      }
    } catch (e) {
      console.error(e);
      toast.error(messageOf(e, "An error occurred."));
      await fetchPhotos();
    } finally {
      setActionInProgress(false);
    }
  };

  // Trigger Delete Confirm Dialog
  const handleDeleteClick = (photoId: string) => {
    setConfirmDeleteId(photoId);
  };

  // Delete Confirm Action
  const handleConfirmDelete = async () => {
    if (!confirmDeleteId) return;
    setActionInProgress(true);
    try {
      const res = await deletePropertyPhoto({
        data: { id: confirmDeleteId },
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        const message = REMOVED_MESSAGES[res.storage] ?? REMOVED_MESSAGES.deleted;
        if (message.kind === "warning") toast.warning(message.text);
        else toast.success(message.text);
        await fetchPhotos();
      } else {
        toast.error(res.error || "Failed to delete photo.");
      }
    } catch (e) {
      console.error(e);
      toast.error(messageOf(e, "An error occurred."));
    } finally {
      setActionInProgress(false);
      setConfirmDeleteId(null);
    }
  };

  // Handle Multi-file Upload
  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const filesArray = Array.from(files);
    const newUploads = filesArray.map((f, i) => ({
      id: `${Date.now()}-${i}`,
      fileName: f.name,
      status: "signing" as const,
    }));

    setUploads((prev) => [...prev, ...newUploads]);

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < filesArray.length; i++) {
      const file = filesArray[i];
      if (!file) continue;

      const uploadStatus = newUploads[i];
      if (!uploadStatus) continue;

      const updateStatus = (status: UploadStatus["status"], error?: string | undefined) => {
        setUploads((prev) =>
          prev.map((up) => (up.id === uploadStatus.id ? { ...up, status, error } : up)),
        );
      };

      try {
        if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
          throw new Error("Only JPEG, PNG, WebP, or GIF images are supported.");
        }

        // 1. Authorized presigned ticket. R2 credentials never reach the browser.
        const ticketRes = await getUploadTicket({
          data: {
            propertyId,
            contentType: file.type,
            byteSize: file.size,
          },
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (!ticketRes.ok) {
          throw new Error(ticketRes.error || "Failed to obtain an upload ticket.");
        }

        const ticket = ticketRes.data;

        // 2. Upload the original directly to the private/public R2 namespace.
        updateStatus("uploading");
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open(ticket.method || "PUT", ticket.uploadUrl, true);
          for (const [header, headerValue] of Object.entries(ticket.headers || {})) {
            xhr.setRequestHeader(header, headerValue);
          }
          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
              setProgress(Math.round((event.loaded / event.total) * 100));
            }
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve();
            } else {
              reject(new Error(describeUploadFailure(xhr.status)));
            }
          };
          xhr.onerror = () =>
            reject(
              new Error(
                "Could not reach the storage bucket. Check that the bucket allows this site (CORS) and that the connection is working.",
              ),
            );
          xhr.send(file);
        });

        // 3. The server verifies size, MIME and magic bytes before persistence.
        updateStatus("saving");
        const dbRes = await savePropertyPhoto({
          data: {
            propertyId,
            key: ticket.key,
            mimeType: file.type,
            alt: file.name,
          },
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (!dbRes.ok) {
          throw new Error(dbRes.error || "Failed to save photo in database.");
        }

        updateStatus("done");
        successCount++;
      } catch (err) {
        console.error("Upload error for file:", file.name, err);
        updateStatus("error", messageOf(err, "Unknown error occurred."));
        failCount++;
      }
    }

    // Refresh after all uploads finish
    await fetchPhotos();

    if (successCount > 0 && failCount === 0) {
      toast.success(`Successfully uploaded ${successCount} photo(s).`);
    } else if (successCount > 0 && failCount > 0) {
      toast.warning(`Uploaded ${successCount} photo(s), but ${failCount} failed.`);
    } else if (failCount > 0) {
      toast.error("Failed to upload photos.");
    }

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <>
      <Dialog
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl p-6 md:p-8 flex flex-col gap-4 font-sans bg-card text-foreground">
          <DialogHeader className="flex flex-row items-center justify-between border-b border-border pb-3 shrink-0">
            <div>
              <DialogTitle className="text-xl md:text-2xl font-display font-bold tracking-tight">
                Manage Photos
              </DialogTitle>
              <p className="text-xs md:text-sm text-muted-foreground mt-0.5">{propertyName}</p>
            </div>
          </DialogHeader>

          {/* Upload Button Section */}
          <div className="shrink-0">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept={ALLOWED_IMAGE_TYPES.join(",")}
              multiple
              className="hidden"
            />
            <button
              type="button"
              onClick={handleUploadClick}
              disabled={loading || actionInProgress}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground px-5 py-3 text-sm font-semibold shadow-sm hover:opacity-90 transition-all cursor-pointer min-h-[48px]"
            >
              <UploadCloud className="size-5" />
              Upload photos
            </button>
          </div>

          {/* Upload Status Overlay/List */}
          {uploads.length > 0 && (
            <div
              className="bg-muted/40 border border-border rounded-xl p-3 max-h-[200px] overflow-y-auto space-y-2 text-xs"
              aria-live="polite"
            >
              {uploads.map((up) => (
                <div key={up.id} className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate max-w-[200px] sm:max-w-xs text-muted-foreground">
                      {up.fileName}
                    </span>
                    <div className="flex items-center gap-1.5 font-medium shrink-0">
                      {up.status === "signing" && (
                        <span className="text-primary flex items-center gap-1">
                          <Loader2 className="size-3 animate-spin" /> Preparing...
                        </span>
                      )}
                      {up.status === "uploading" && (
                        <span className="text-amber-500 flex items-center gap-1">
                          <Loader2 className="size-3 animate-spin" /> Uploading...
                        </span>
                      )}
                      {up.status === "saving" && (
                        <span className="text-blue-500 flex items-center gap-1">
                          <Loader2 className="size-3 animate-spin" /> Saving...
                        </span>
                      )}
                      {up.status === "done" && <span className="text-emerald-600">Done</span>}
                      {up.status === "error" && <span className="text-destructive">Error</span>}
                    </div>
                  </div>
                  {up.status === "error" && up.error && (
                    <p className="break-words text-foreground/90">{up.error}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Photo Grid Section */}
          <div className="flex-1 min-h-[200px]">
            {loading ? (
              <div className="flex h-48 items-center justify-center">
                <Loader2 className="size-8 animate-spin text-primary" />
              </div>
            ) : photos.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-center rounded-2xl border border-dashed border-border bg-muted/20 p-6">
                <ImageIcon className="size-10 text-muted-foreground/40 mb-2" />
                <p className="text-sm text-muted-foreground font-medium">
                  No photos yet. Upload the first one.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 pb-4">
                {photos.map((photo, index) => (
                  <div
                    key={photo.id}
                    className="flex flex-col border border-border rounded-xl bg-card overflow-hidden shadow-sm hover:shadow-md transition-shadow"
                  >
                    {/* Thumbnail Image */}
                    <div className="relative aspect-square bg-muted/40">
                      <img
                        src={photo.public_url}
                        alt={photo.alt || "Property photo"}
                        className="w-full h-full object-cover"
                      />
                      {photo.is_cover && (
                        <span className="absolute top-2 left-2 bg-primary text-primary-foreground text-[10px] sm:text-xs font-semibold px-2 py-0.5 sm:py-1 rounded-lg flex items-center gap-1 shadow-sm select-none">
                          <Star className="size-3 fill-current" /> Cover
                        </span>
                      )}
                    </div>

                    {/* Action buttons (usable touch targets >= 40px) */}
                    <div className="p-1.5 grid grid-cols-4 gap-0.5 border-t border-border bg-muted/10 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleSetCover(photo.id)}
                        disabled={photo.is_cover || actionInProgress}
                        className="flex items-center justify-center p-2 rounded-lg hover:bg-accent text-amber-500 disabled:text-muted-foreground/30 disabled:hover:bg-transparent min-h-[40px] cursor-pointer"
                        aria-label="Set as cover"
                        title="Set as Cover"
                      >
                        <Star className={`size-4 ${photo.is_cover ? "fill-current" : ""}`} />
                      </button>

                      <button
                        type="button"
                        onClick={() => handleMove(index, "up")}
                        disabled={index === 0 || actionInProgress}
                        className="flex items-center justify-center p-2 rounded-lg hover:bg-accent text-foreground disabled:opacity-30 min-h-[40px] cursor-pointer"
                        aria-label="Move up"
                        title="Move Up"
                      >
                        <ArrowUp className="size-4" />
                      </button>

                      <button
                        type="button"
                        onClick={() => handleMove(index, "down")}
                        disabled={index === photos.length - 1 || actionInProgress}
                        className="flex items-center justify-center p-2 rounded-lg hover:bg-accent text-foreground disabled:opacity-30 min-h-[40px] cursor-pointer"
                        aria-label="Move down"
                        title="Move Down"
                      >
                        <ArrowDown className="size-4" />
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDeleteClick(photo.id)}
                        disabled={actionInProgress}
                        className="flex items-center justify-center p-2 rounded-lg hover:bg-destructive/10 text-destructive disabled:opacity-50 min-h-[40px] cursor-pointer"
                        aria-label="Delete photo"
                        title="Delete"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Alert */}
      <AlertDialog
        open={confirmDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDeleteId(null);
        }}
      >
        <AlertDialogContent className="rounded-2xl max-w-md p-6 bg-card border border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-xl font-bold text-foreground">
              Delete Photo?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-muted-foreground">
              Are you sure you want to delete this photo? It will be removed from this site
              immediately. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 gap-2">
            <AlertDialogCancel asChild>
              <button
                className="inline-flex items-center justify-center rounded-xl border border-border px-4 py-2.5 text-sm font-medium hover:bg-accent text-foreground transition-colors cursor-pointer"
                style={{ minHeight: "44px" }}
              >
                Cancel
              </button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <button
                onClick={handleConfirmDelete}
                disabled={actionInProgress}
                className="inline-flex items-center justify-center rounded-xl bg-destructive text-destructive-foreground px-4 py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-colors cursor-pointer"
                style={{ minHeight: "44px" }}
              >
                {actionInProgress ? "Deleting..." : "Delete Photo"}
              </button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
