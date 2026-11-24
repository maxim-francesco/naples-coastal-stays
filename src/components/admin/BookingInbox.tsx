import React, { useEffect, useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  listBookingRequests,
  updateBookingStatus,
  deleteBookingRequest,
  type DBBookingRequest,
} from "@/lib/bookings.server";
import type { DBProperty } from "@/lib/adminProperties.server";
import {
  Mail,
  User,
  Calendar,
  Users,
  Check,
  X,
  Trash2,
  Loader2,
  Clock,
  MessageSquare,
} from "lucide-react";
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

interface BookingInboxProps {
  accessToken: string | undefined;
  properties: DBProperty[];
}

function messageFromError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function BookingInbox({ accessToken, properties }: BookingInboxProps) {
  const [bookings, setBookings] = useState<DBBookingRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<"all" | "new" | "confirmed" | "declined">("all");

  // Action processing states
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Message collapse state: maps request ID to boolean
  const [expandedMessages, setExpandedMessages] = useState<Record<string, boolean>>({});

  const loadBookings = async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await listBookingRequests({
        data: { statusFilter: "all", accessToken },
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      setBookings(res);
    } catch (e: unknown) {
      console.error(e);
      toast.error(messageFromError(e, "Failed to load bookings"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (accessToken) {
      loadBookings();
    }
  }, [accessToken]);

  const handleStatusChange = async (id: string, newStatus: "new" | "confirmed" | "declined") => {
    setProcessingId(id);
    try {
      const res = await updateBookingStatus({
        data: { id, status: newStatus, accessToken },
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        toast.success(`Booking status updated to ${newStatus}`);
        await loadBookings();
      } else {
        toast.error(res.error || "Failed to update status");
      }
    } catch (err: unknown) {
      toast.error(messageFromError(err, "An error occurred"));
    } finally {
      setProcessingId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      const res = await deleteBookingRequest({
        data: { id: deleteId, accessToken },
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        toast.success("Booking request deleted successfully");
        setDeleteId(null);
        await loadBookings();
      } else {
        toast.error(res.error || "Failed to delete request");
      }
    } catch (err: unknown) {
      toast.error(messageFromError(err, "An error occurred"));
    } finally {
      setDeleting(false);
    }
  };

  const formatLocalDateString = (dateStr: string) => {
    const [y, m, d] = dateStr.split("-").map(Number);
    if (!y || !m || !d) return dateStr;
    const date = new Date(y, m - 1, d);
    return format(date, "MMM d, yyyy");
  };

  const toggleMessage = (id: string) => {
    setExpandedMessages((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  // Status counts
  const countAll = bookings.length;
  const countNew = bookings.filter((b) => b.status === "new").length;
  const countConfirmed = bookings.filter((b) => b.status === "confirmed").length;
  const countDeclined = bookings.filter((b) => b.status === "declined").length;

  // Filtered Bookings
  const filteredBookings = bookings.filter((b) => filter === "all" || b.status === filter);

  if (loading && bookings.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Segmented Filter Control */}
      <div className="flex border-b border-border overflow-x-auto no-scrollbar scroll-smooth">
        <button
          onClick={() => setFilter("all")}
          className={`flex-1 py-3 text-center border-b-2 text-[13px] font-semibold sm:min-w-[90px] sm:text-sm transition-all whitespace-nowrap cursor-pointer ${
            filter === "all"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          All ({countAll})
        </button>
        <button
          onClick={() => setFilter("new")}
          className={`flex-1 py-3 text-center border-b-2 text-[13px] font-semibold sm:min-w-[90px] sm:text-sm transition-all whitespace-nowrap cursor-pointer ${
            filter === "new"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          New ({countNew})
        </button>
        <button
          onClick={() => setFilter("confirmed")}
          className={`flex-1 py-3 text-center border-b-2 text-[13px] font-semibold sm:min-w-[90px] sm:text-sm transition-all whitespace-nowrap cursor-pointer ${
            filter === "confirmed"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Confirmed ({countConfirmed})
        </button>
        <button
          onClick={() => setFilter("declined")}
          className={`flex-1 py-3 text-center border-b-2 text-[13px] font-semibold sm:min-w-[90px] sm:text-sm transition-all whitespace-nowrap cursor-pointer ${
            filter === "declined"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Declined ({countDeclined})
        </button>
      </div>

      {/* Bookings List */}
      {filteredBookings.length === 0 ? (
        <div className="text-center rounded-2xl border border-dashed border-border bg-card p-12">
          <Clock className="mx-auto size-12 text-muted-foreground/50 mb-4" />
          <h3 className="font-display text-lg font-medium text-foreground">No bookings found</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            No booking requests match the selected status filter.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6">
          {filteredBookings.map((booking) => {
            const property = properties.find((p) => p.id === booking.property_id);
            const propertyName = property ? property.name : "—";
            const isExpanded = !!expandedMessages[booking.id];

            return (
              <div
                key={booking.id}
                className="rounded-2xl border border-border bg-card p-5 md:p-6 shadow-soft hover:shadow-lift transition-all space-y-4"
              >
                {/* Header Row */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex size-9 items-center justify-center rounded-full bg-accent text-primary shrink-0">
                      <User className="size-4" />
                    </span>
                    <div>
                      <h3 className="font-display font-bold text-lg text-foreground leading-tight">
                        {booking.guest_name}
                      </h3>
                      {booking.created_at && (
                        <p className="text-[11px] text-muted-foreground">
                          Submitted {format(new Date(booking.created_at), "MMM d, yyyy h:mm a")}
                        </p>
                      )}
                    </div>
                  </div>
                  <div>
                    {booking.status === "new" ? (
                      <span className="inline-flex text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-900/50">
                        New Request
                      </span>
                    ) : booking.status === "confirmed" ? (
                      <span className="inline-flex text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900/50">
                        Confirmed
                      </span>
                    ) : (
                      <span className="inline-flex text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-900/50">
                        Declined
                      </span>
                    )}
                  </div>
                </div>

                {/* Details Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 py-3 border-y border-border/50 text-sm">
                  {/* Property Name */}
                  <div className="space-y-1">
                    <span className="text-xs font-semibold text-muted-foreground">Property</span>
                    <p className="font-medium text-foreground">{propertyName}</p>
                  </div>

                  {/* Dates */}
                  <div className="space-y-1">
                    <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                      <Calendar className="size-3.5 text-primary" /> Dates
                    </span>
                    <p className="font-medium text-foreground">
                      {formatLocalDateString(booking.check_in)} →{" "}
                      {formatLocalDateString(booking.check_out)}
                    </p>
                  </div>

                  {/* Guests */}
                  <div className="space-y-1">
                    <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                      <Users className="size-3.5 text-primary" /> Guests
                    </span>
                    <p className="font-medium text-foreground">
                      {booking.guests} {booking.guests === 1 ? "guest" : "guests"}
                    </p>
                  </div>

                  {/* Email */}
                  <div className="space-y-1">
                    <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                      <Mail className="size-3.5 text-primary" /> Contact
                    </span>
                    <div>
                      <a
                        href={`mailto:${booking.email}?subject=Booking Request - ${propertyName}`}
                        className="font-medium text-primary hover:underline inline-flex items-center gap-1 break-all"
                      >
                        {booking.email}
                      </a>
                    </div>
                  </div>
                </div>

                {/* Message */}
                {booking.message && (
                  <div className="space-y-1 bg-muted/40 rounded-xl p-3.5">
                    <div className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                      <MessageSquare className="size-3.5 text-primary" /> Guest Message
                    </div>
                    <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">
                      {booking.message.length > 150 && !isExpanded
                        ? `${booking.message.substring(0, 150)}...`
                        : booking.message}
                    </p>
                    {booking.message.length > 150 && (
                      <button
                        onClick={() => toggleMessage(booking.id)}
                        className="text-xs font-semibold text-primary hover:underline mt-1 focus:outline-none cursor-pointer"
                      >
                        {isExpanded ? "Show less" : "Show more"}
                      </button>
                    )}
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {booking.status !== "confirmed" && (
                      <button
                        onClick={() => handleStatusChange(booking.id, "confirmed")}
                        disabled={processingId !== null}
                        className="inline-flex items-center justify-center gap-1 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 px-4 py-2 text-xs font-semibold shadow-sm transition-all disabled:opacity-50 cursor-pointer"
                        style={{ minHeight: "44px" }}
                      >
                        {processingId === booking.id ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <Check className="size-3.5" />
                        )}
                        Confirm
                      </button>
                    )}
                    {booking.status !== "declined" && (
                      <button
                        onClick={() => handleStatusChange(booking.id, "declined")}
                        disabled={processingId !== null}
                        className="inline-flex items-center justify-center gap-1 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 px-4 py-2 text-xs font-semibold transition-all disabled:opacity-50 cursor-pointer"
                        style={{ minHeight: "44px" }}
                      >
                        {processingId === booking.id ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <X className="size-3.5" />
                        )}
                        Decline
                      </button>
                    )}
                    {booking.status !== "new" && (
                      <button
                        onClick={() => handleStatusChange(booking.id, "new")}
                        disabled={processingId !== null}
                        className="inline-flex items-center justify-center gap-1 rounded-xl border border-border bg-card hover:bg-accent text-foreground px-4 py-2 text-xs font-semibold transition-all disabled:opacity-50 cursor-pointer"
                        style={{ minHeight: "44px" }}
                      >
                        Mark New
                      </button>
                    )}
                  </div>

                  <button
                    onClick={() => setDeleteId(booking.id)}
                    disabled={processingId !== null}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-destructive/20 bg-destructive/5 hover:bg-destructive/10 px-3.5 py-2 text-xs font-semibold text-destructive transition-all disabled:opacity-50 cursor-pointer"
                    style={{ minHeight: "44px" }}
                  >
                    <Trash2 className="size-3.5" />
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Delete Confirmation Alert Dialog */}
      <AlertDialog
        open={deleteId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteId(null);
        }}
      >
        <AlertDialogContent className="rounded-2xl max-w-md p-6">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-xl font-bold">
              Delete Booking Request
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm">
              Are you sure you want to permanently delete this booking request? This action will
              remove it from the database and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 gap-2">
            <AlertDialogCancel asChild>
              <button
                className="inline-flex items-center justify-center rounded-xl border border-border px-4 py-2.5 text-sm font-medium hover:bg-accent transition-colors cursor-pointer"
                style={{ minHeight: "44px" }}
              >
                Cancel
              </button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="inline-flex items-center justify-center rounded-xl bg-destructive text-destructive-foreground px-4 py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-colors cursor-pointer"
                style={{ minHeight: "44px" }}
              >
                {deleting ? "Deleting..." : "Delete Request"}
              </button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
