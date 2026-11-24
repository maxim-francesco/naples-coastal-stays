"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addDays, addMonths, endOfMonth, format, startOfMonth } from "date-fns";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  Lock,
  Mail,
  MessageSquare,
  RefreshCw,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import {
  blockedDateSet,
  blockingRanges,
  dateOnlyToLocalDate,
  daysBetweenDateOnly,
  findAvailabilityConflict,
  todayInTimeZone,
  type AvailabilityRange,
} from "@/lib/availability";
import {
  createBlackout,
  deleteBlackout,
  getAdminAvailability,
  type AdminAvailability,
  type AdminCalendarBlackout,
  type AdminCalendarBooking,
} from "@/lib/availability.server";
import { updateBookingStatus } from "@/lib/bookings.server";
import type { DBProperty } from "@/lib/adminProperties.server";

interface AvailabilityCalendarProps {
  accessToken: string | undefined;
  properties: DBProperty[];
}

interface AdminSelection {
  start: string | null;
  end: string | null;
}

const statusBadge: Record<string, string> = {
  confirmed:
    "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900/50",
  new: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/30 dark:text-sky-400 dark:border-sky-900/50",
  declined:
    "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-900/50",
};

const statusLabel: Record<string, string> = {
  confirmed: "Confirmed",
  new: "Pending",
  declined: "Declined",
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function statusClass(status: string) {
  return statusBadge[status] ?? statusBadge["new"];
}

function displayDate(value: string) {
  if (!value) return "—";
  return format(dateOnlyToLocalDate(value), "MMM d, yyyy");
}

function rangeNights(range: AvailabilityRange) {
  return Math.max(0, daysBetweenDateOnly(range.start, range.end));
}

function errorMessage(error: unknown): string | null {
  return error instanceof Error ? error.message : null;
}

function monthCells(monthDate: Date): (string | null)[] {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = Array.from({ length: first.getDay() }, () => null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(`${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  }
  return cells;
}

function pendingOverlap(
  range: AvailabilityRange,
  bookings: AdminCalendarBooking[],
): AdminCalendarBooking | null {
  return (
    bookings.find(
      (booking) =>
        booking.status === "new" && booking.checkIn < range.end && range.start < booking.checkOut,
    ) ?? null
  );
}

export function AvailabilityCalendar({ accessToken, properties }: AvailabilityCalendarProps) {
  const firstPropertyId = properties[0]?.id ?? "";
  const [propertyId, setPropertyId] = useState(firstPropertyId);
  const [month, setMonth] = useState(() => startOfMonth(dateOnlyToLocalDate(todayInTimeZone())));
  const [data, setData] = useState<AdminAvailability | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<AdminSelection>({ start: null, end: null });
  const [hint, setHint] = useState<string | null>(null);
  const [blockDialogOpen, setBlockDialogOpen] = useState(false);
  const [blockNote, setBlockNote] = useState("");
  const [blockError, setBlockError] = useState<string | null>(null);
  const [isBlocking, setIsBlocking] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState<AdminCalendarBooking | null>(null);
  const blockReturnFocusRef = useRef<HTMLElement | null>(null);
  const bookingReturnFocusRef = useRef<HTMLElement | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [processingBookingId, setProcessingBookingId] = useState<string | null>(null);
  const [unblockTarget, setUnblockTarget] = useState<AdminCalendarBlackout | null>(null);
  const [deletingBlackoutId, setDeletingBlackoutId] = useState<string | null>(null);
  const [declineTarget, setDeclineTarget] = useState<AdminCalendarBooking | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    if (!properties.some((property) => property.id === propertyId)) {
      setPropertyId(firstPropertyId);
    }
  }, [properties, propertyId, firstPropertyId]);

  const load = useCallback(
    async (silent = false) => {
      if (!accessToken || !propertyId) return;
      const currentRequest = ++requestId.current;
      if (silent) setRefreshing(true);
      else {
        setLoading(true);
        // Never keep showing the previous month's availability while a new
        // range loads: stale "available" nights would be misleading.
        setData(null);
      }
      setError(null);
      try {
        const result = await getAdminAvailability({
          data: {
            propertyId,
            from: format(startOfMonth(month), "yyyy-MM-dd"),
            to: format(addDays(endOfMonth(month), 1), "yyyy-MM-dd"),
            accessToken,
          },
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (currentRequest === requestId.current) setData(result);
      } catch (err) {
        console.error(err);
        if (currentRequest === requestId.current) {
          setError(errorMessage(err) || "Could not load the calendar.");
        }
      } finally {
        if (currentRequest === requestId.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [accessToken, propertyId, month],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setSelection({ start: null, end: null });
    setHint(null);
    setSelectedBooking(null);
    setActionError(null);
  }, [propertyId, month]);

  const confirmedRanges = useMemo<AvailabilityRange[]>(
    () =>
      (data?.bookings ?? [])
        .filter((booking) => booking.status === "confirmed")
        .map((booking) => ({ start: booking.checkIn, end: booking.checkOut })),
    [data],
  );
  const pendingRanges = useMemo<AvailabilityRange[]>(
    () =>
      (data?.bookings ?? [])
        .filter((booking) => booking.status === "new")
        .map((booking) => ({ start: booking.checkIn, end: booking.checkOut })),
    [data],
  );
  const blackoutRanges = useMemo<AvailabilityRange[]>(
    () => (data?.blackouts ?? []).map((blackout) => ({ start: blackout.start, end: blackout.end })),
    [data],
  );

  const confirmedDays = useMemo(() => blockedDateSet(confirmedRanges), [confirmedRanges]);
  const pendingDays = useMemo(() => blockedDateSet(pendingRanges), [pendingRanges]);
  const blackoutDays = useMemo(() => blockedDateSet(blackoutRanges), [blackoutRanges]);

  const blocking = useMemo(
    () =>
      blockingRanges({
        blackouts: blackoutRanges,
        bookings:
          data?.bookings.map((booking) => ({
            checkIn: booking.checkIn,
            checkOut: booking.checkOut,
            status: booking.status,
          })) ?? [],
      }),
    [blackoutRanges, data],
  );

  const selectedRange = useMemo<AvailabilityRange | null>(() => {
    if (!selection.start || !selection.end) return null;
    if (selection.start >= selection.end) return null;
    return { start: selection.start, end: selection.end };
  }, [selection]);

  const selectedNights = selectedRange ? rangeNights(selectedRange) : 0;
  const selectedConflict = useMemo(
    () => (selectedRange ? findAvailabilityConflict(selectedRange, blocking) : null),
    [selectedRange, blocking],
  );
  const selectedPending = useMemo(
    () => (selectedRange ? pendingOverlap(selectedRange, data?.bookings ?? []) : null),
    [selectedRange, data],
  );

  const cells = useMemo(() => monthCells(month), [month]);
  const today = data?.today ?? todayInTimeZone();

  const handleSelect = (day: string) => {
    setHint(null);
    const isPast = day < today;
    const isUnavailable = confirmedDays.has(day) || blackoutDays.has(day);
    const { start, end } = selection;

    if (isPast) {
      setHint("Choose today or a later date.");
      return;
    }

    if (!start || end) {
      if (isUnavailable) {
        setHint("That night is already confirmed or blocked. Pick a free night.");
        return;
      }
      setSelection({ start: day, end: null });
      return;
    }

    if (day <= start) {
      if (isUnavailable) {
        setHint("That night is already confirmed or blocked. Pick a free night.");
        return;
      }
      setSelection({ start: day, end: null });
      return;
    }

    const conflict = findAvailabilityConflict({ start, end: day }, blocking);
    if (conflict) {
      setHint(
        `This range overlaps a confirmed booking or block (${displayDate(conflict.start)} – ${displayDate(conflict.end)}).`,
      );
      return;
    }

    setSelection({ start, end: day });
  };

  const goToToday = () => {
    setMonth(startOfMonth(dateOnlyToLocalDate(todayInTimeZone())));
  };

  const handleBlock = async () => {
    if (!selectedRange || !accessToken) return;
    setIsBlocking(true);
    setBlockError(null);
    try {
      const result = await createBlackout({
        data: {
          propertyId,
          start: selectedRange.start,
          end: selectedRange.end,
          note: blockNote.trim(),
          accessToken,
        },
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (result.ok) {
        toast.success("Dates blocked.");
        setBlockDialogOpen(false);
        setBlockNote("");
        setSelection({ start: null, end: null });
        await load(true);
      } else {
        setBlockError(result.error);
      }
    } catch (err) {
      setBlockError(errorMessage(err) || "Could not block those dates.");
    } finally {
      setIsBlocking(false);
    }
  };

  const handleUnblock = async () => {
    if (!unblockTarget || !accessToken) return;
    setDeletingBlackoutId(unblockTarget.id);
    try {
      const result = await deleteBlackout({
        data: { id: unblockTarget.id, accessToken },
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (result.ok) {
        toast.success("Dates unblocked.");
        setUnblockTarget(null);
        await load(true);
      } else {
        toast.error(result.error);
      }
    } catch (err) {
      toast.error(errorMessage(err) || "Could not unblock those dates.");
    } finally {
      setDeletingBlackoutId(null);
    }
  };

  const handleBookingStatus = async (
    booking: AdminCalendarBooking,
    status: "confirmed" | "declined",
  ) => {
    if (!accessToken) return;
    setProcessingBookingId(booking.id);
    setActionError(null);
    try {
      const result = await updateBookingStatus({
        data: { id: booking.id, status, accessToken },
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (result.ok) {
        toast.success(status === "confirmed" ? "Booking confirmed." : "Booking declined.");
        setSelectedBooking(null);
        setDeclineTarget(null);
        await load(true);
      } else {
        setActionError(result.error);
        toast.error(result.error);
      }
    } catch (err) {
      const message = errorMessage(err) || "Could not update the booking.";
      setActionError(message);
      toast.error(message);
    } finally {
      setProcessingBookingId(null);
    }
  };

  if (properties.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center">
        <CalendarDays className="mx-auto size-12 text-muted-foreground/50" />
        <h2 className="mt-4 font-display text-lg font-medium">No properties yet</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Add a property before managing its availability.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="eyebrow">Calendar</p>
          <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-foreground">
            Availability
          </h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Confirm requests, inspect bookings and block maintenance dates. Pending requests do not
            block the calendar until you confirm them.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={refreshing || loading}
          className="inline-flex min-h-11 items-center justify-center gap-2 self-start rounded-full border border-border bg-card px-4 text-sm font-semibold text-foreground hover:bg-accent disabled:opacity-60 lg:self-auto"
        >
          <RefreshCw className={cn("size-4", refreshing && "animate-spin")} aria-hidden="true" />
          Refresh
        </button>
      </div>

      <div>
        <p className="mb-2 text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
          Property
        </p>
        <div
          role="group"
          aria-label="Select property"
          className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap"
        >
          {properties.map((property) => (
            <button
              key={property.id}
              type="button"
              onClick={() => setPropertyId(property.id)}
              aria-pressed={property.id === propertyId}
              className={cn(
                "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold transition-colors sm:min-w-40",
                property.id === propertyId
                  ? "border-primary bg-primary text-primary-foreground shadow-sm"
                  : "border-border bg-card text-foreground hover:bg-accent",
              )}
            >
              <span className="truncate">{property.name}</span>
              {!property.is_active && (
                <span
                  className={cn(
                    "shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase",
                    property.id === propertyId
                      ? "bg-primary-foreground/20"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  Inactive
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="rounded-3xl border border-border bg-card p-3 shadow-soft sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setMonth(addMonths(month, -1))}
                aria-label="Previous month"
                className="size-11 rounded-full"
              >
                <ChevronLeft className="size-4" />
              </Button>
              <h2 className="min-w-36 text-center font-display text-lg font-semibold sm:text-xl">
                {format(month, "MMMM yyyy")}
              </h2>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setMonth(addMonths(month, 1))}
                aria-label="Next month"
                className="size-11 rounded-full"
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
            <div className="ml-auto flex items-center gap-2">
              {loading && (
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> Loading
                </span>
              )}
              <Button type="button" variant="outline" onClick={goToToday} className="min-h-11">
                Today
              </Button>
            </div>
          </div>

          {error ? (
            <div className="mt-4 rounded-2xl border border-destructive/20 bg-destructive/5 p-6 text-center">
              <p className="text-sm font-medium text-destructive" role="alert">
                {error}
              </p>
              <Button
                type="button"
                variant="outline"
                className="mt-4 min-h-11"
                onClick={() => void load()}
              >
                Try again
              </Button>
            </div>
          ) : loading && !data ? (
            <div className="flex h-80 items-center justify-center" role="status">
              <Loader2 className="size-8 animate-spin text-primary" />
              <span className="sr-only">Loading availability</span>
            </div>
          ) : (
            <>
              <div
                className="mt-4 grid grid-cols-7"
                role="grid"
                aria-label={format(month, "MMMM yyyy")}
              >
                {WEEKDAYS.map((day) => (
                  <div
                    key={day}
                    role="columnheader"
                    className="pb-2 text-center text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase sm:text-[11px]"
                  >
                    {day.slice(0, 1)}
                    <span className="sr-only">{day}</span>
                  </div>
                ))}

                {cells.map((day, index) => {
                  if (!day) return <div key={`empty-${index}`} aria-hidden="true" />;

                  const isPast = day < today;
                  const isConfirmed = confirmedDays.has(day);
                  const isPending = pendingDays.has(day);
                  const isBlackout = blackoutDays.has(day);
                  const isStart = selection.start === day;
                  const isEnd = selection.end === day;
                  const inRange = Boolean(
                    selection.start &&
                    selection.end &&
                    day > selection.start &&
                    day < selection.end,
                  );
                  const canChooseAsCheckout =
                    Boolean(selection.start) &&
                    !selection.end &&
                    day > (selection.start as string) &&
                    !findAvailabilityConflict(
                      { start: selection.start as string, end: day },
                      blocking,
                    );
                  const interactive =
                    !isPast && ((!isConfirmed && !isBlackout) || canChooseAsCheckout);

                  let label = `${format(dateOnlyToLocalDate(day), "EEEE, MMMM d, yyyy")} — available`;
                  if (isPast)
                    label = `${format(dateOnlyToLocalDate(day), "EEEE, MMMM d, yyyy")} — past`;
                  else if (isConfirmed)
                    label = `${format(dateOnlyToLocalDate(day), "EEEE, MMMM d, yyyy")} — confirmed booking`;
                  else if (isBlackout)
                    label = `${format(dateOnlyToLocalDate(day), "EEEE, MMMM d, yyyy")} — blocked`;
                  else if (isPending)
                    label = `${format(dateOnlyToLocalDate(day), "EEEE, MMMM d, yyyy")} — pending request`;
                  if (isStart) label = `${displayDate(day)} — selected check-in`;
                  if (isEnd) label = `${displayDate(day)} — selected check-out`;

                  return (
                    <div key={day} className="min-w-0">
                      <button
                        type="button"
                        onClick={() => handleSelect(day)}
                        aria-label={label}
                        aria-pressed={isStart || isEnd}
                        className={cn(
                          "relative flex h-11 min-h-11 w-full items-center justify-center rounded-xl text-[13px] font-medium transition-colors sm:text-sm",
                          "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:outline-none",
                          isPast && "cursor-not-allowed text-muted-foreground/35",
                          !isPast &&
                            !isConfirmed &&
                            !isBlackout &&
                            !isPending &&
                            !isStart &&
                            !isEnd &&
                            "text-foreground hover:bg-accent",
                          isConfirmed &&
                            !isStart &&
                            !isEnd &&
                            "bg-emerald-100 text-emerald-900 hover:bg-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-200",
                          isBlackout &&
                            !isStart &&
                            !isEnd &&
                            "bg-rose-100 text-rose-900 hover:bg-rose-200 dark:bg-rose-950/60 dark:text-rose-200",
                          isPending &&
                            !isConfirmed &&
                            !isBlackout &&
                            !isStart &&
                            !isEnd &&
                            "bg-sky-100 text-sky-900 ring-1 ring-sky-300 ring-inset hover:bg-sky-200 dark:bg-sky-950/60 dark:text-sky-200",
                          inRange && "rounded-none bg-primary/10 text-primary-strong",
                          isStart && "rounded-full bg-primary text-primary-foreground shadow-sm",
                          isEnd && "rounded-full bg-primary text-primary-foreground shadow-sm",
                          day === today &&
                            !isStart &&
                            !isEnd &&
                            "ring-1 ring-primary/40 ring-inset",
                        )}
                      >
                        {Number(day.slice(8, 10))}
                        {isPending && !isConfirmed && !isBlackout && !isStart && !isEnd && (
                          <span
                            aria-hidden="true"
                            className="absolute bottom-1 size-1 rounded-full bg-sky-500"
                          />
                        )}
                        {!interactive && !isPast && <span className="sr-only">, unavailable</span>}
                      </button>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-3 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2.5 rounded-full bg-emerald-500" /> Confirmed
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2.5 rounded-full bg-sky-500" /> Pending
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2.5 rounded-full bg-rose-500" /> Blocked
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2.5 rounded-full bg-primary" /> Selected
                </span>
              </div>

              <p
                className="mt-1 min-h-5 text-xs font-medium text-destructive"
                role="status"
                aria-live="polite"
              >
                {hint}
              </p>

              {selectedRange && (
                <div className="mt-1 rounded-2xl border border-border bg-background p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-semibold">
                      {displayDate(selectedRange.start)} → {displayDate(selectedRange.end)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {selectedNights} {selectedNights === 1 ? "night" : "nights"}
                    </p>
                  </div>
                  {selectedConflict ? (
                    <p className="mt-2 text-sm font-medium text-destructive" role="status">
                      This range overlaps a confirmed booking or an existing block.
                    </p>
                  ) : selectedPending ? (
                    <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-400">
                      A pending request overlaps these dates. Blocking is allowed, but that request
                      will fail if you try to confirm it later.
                    </p>
                  ) : null}
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <Button
                      type="button"
                      className="min-h-11"
                      onClick={() => {
                        setBlockError(null);
                        setBlockDialogOpen(true);
                      }}
                      disabled={Boolean(selectedConflict) || selectedNights < 1}
                    >
                      <Lock className="size-4" aria-hidden="true" />
                      Block these dates
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11"
                      onClick={() => setSelection({ start: null, end: null })}
                    >
                      Clear selection
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>

        <div className="space-y-5">
          <section className="rounded-2xl border border-border bg-card p-4 shadow-soft">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-lg font-semibold">Bookings this month</h2>
              <span className="text-xs text-muted-foreground">{data?.bookings.length ?? 0}</span>
            </div>
            {!data ? (
              <p className="mt-4 text-sm text-muted-foreground">Loading bookings…</p>
            ) : data.bookings.length === 0 ? (
              <div className="mt-4 rounded-xl border border-dashed border-border p-5 text-center">
                <CalendarDays className="mx-auto size-6 text-muted-foreground/50" />
                <p className="mt-2 text-sm text-muted-foreground">
                  No booking requests overlap this month.
                </p>
              </div>
            ) : (
              <ul className="mt-4 space-y-2.5">
                {data.bookings.map((booking) => (
                  <li key={booking.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setActionError(null);
                        setSelectedBooking(booking);
                      }}
                      className="w-full min-h-11 rounded-xl border border-border bg-background p-3 text-left transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-medium text-foreground">{booking.guestName}</span>
                        <span
                          className={cn(
                            "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                            statusClass(booking.status),
                          )}
                        >
                          {statusLabel[booking.status] ?? booking.status}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {displayDate(booking.checkIn)} → {displayDate(booking.checkOut)} ·{" "}
                        {Math.max(0, daysBetweenDateOnly(booking.checkIn, booking.checkOut))}{" "}
                        {daysBetweenDateOnly(booking.checkIn, booking.checkOut) === 1
                          ? "night"
                          : "nights"}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {booking.guests} {booking.guests === 1 ? "guest" : "guests"}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-border bg-card p-4 shadow-soft">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-lg font-semibold">Manual blocks</h2>
              <span className="text-xs text-muted-foreground">{data?.blackouts.length ?? 0}</span>
            </div>
            {!data ? (
              <p className="mt-4 text-sm text-muted-foreground">Loading blocked dates…</p>
            ) : data.blackouts.length === 0 ? (
              <div className="mt-4 rounded-xl border border-dashed border-border p-5 text-center">
                <Lock className="mx-auto size-6 text-muted-foreground/50" />
                <p className="mt-2 text-sm text-muted-foreground">No manual blocks this month.</p>
              </div>
            ) : (
              <ul className="mt-4 space-y-2.5">
                {data.blackouts.map((blackout) => (
                  <li
                    key={blackout.id}
                    className="flex items-start justify-between gap-3 rounded-xl border border-border bg-background p-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {displayDate(blackout.start)} → {displayDate(blackout.end)}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {rangeNights(blackout)} {rangeNights(blackout) === 1 ? "night" : "nights"}
                        {blackout.note ? ` · ${blackout.note}` : ""}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-11 shrink-0 rounded-full"
                      onClick={() => setUnblockTarget(blackout)}
                      aria-label={`Unblock ${displayDate(blackout.start)} to ${displayDate(blackout.end)}`}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <Dialog
        open={blockDialogOpen}
        onOpenChange={(open) => {
          setBlockDialogOpen(open);
          if (!open) {
            setBlockError(null);
            setBlockNote("");
          }
        }}
      >
        <DialogContent
          className="max-w-md rounded-3xl p-6"
          onOpenAutoFocus={() => {
            blockReturnFocusRef.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }}
          onCloseAutoFocus={(event) => {
            const target = blockReturnFocusRef.current;
            if (target && document.contains(target)) {
              event.preventDefault();
              target.focus();
            }
            blockReturnFocusRef.current = null;
          }}
        >
          <DialogHeader>
            <DialogTitle className="font-display text-xl font-bold">Block dates</DialogTitle>
            <DialogDescription>
              {selectedRange
                ? `${displayDate(selectedRange.start)} → ${displayDate(selectedRange.end)} (${selectedNights} ${selectedNights === 1 ? "night" : "nights"}). Guests will not be able to request these nights.`
                : "Select a date range on the calendar first."}
            </DialogDescription>
          </DialogHeader>
          {selectedPending && (
            <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
              Pending request from {selectedPending.guestName} overlaps these dates. If you block
              them, that request cannot be confirmed later.
            </p>
          )}
          <div className="mt-4 space-y-2">
            <Label htmlFor="block-note">Note (optional)</Label>
            <Input
              id="block-note"
              value={blockNote}
              maxLength={280}
              onChange={(event) => setBlockNote(event.target.value)}
              placeholder="Maintenance, owner stay, deep cleaning…"
              className="min-h-11 rounded-xl"
            />
          </div>
          {blockError && (
            <p className="mt-3 text-sm font-medium text-destructive" role="alert">
              {blockError}
            </p>
          )}
          <DialogFooter className="mt-5 gap-2">
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => setBlockDialogOpen(false)}
              disabled={isBlocking}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="min-h-11"
              onClick={() => void handleBlock()}
              disabled={isBlocking || !selectedRange}
            >
              {isBlocking ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Lock className="size-4" />
              )}
              Block dates
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={selectedBooking !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedBooking(null);
            setActionError(null);
          }
        }}
      >
        <DialogContent
          className="max-sm:inset-x-0 max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:max-h-[92dvh] max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-t-[28px] max-sm:rounded-b-none max-sm:border-b-0 max-sm:p-0 sm:max-w-lg sm:rounded-3xl"
          onOpenAutoFocus={() => {
            bookingReturnFocusRef.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }}
          onCloseAutoFocus={(event) => {
            const target = bookingReturnFocusRef.current;
            if (target && document.contains(target)) {
              event.preventDefault();
              target.focus();
            }
            bookingReturnFocusRef.current = null;
          }}
        >
          {selectedBooking && (
            <div className="max-h-[92dvh] overflow-y-auto p-5 sm:max-h-[90vh] sm:p-6">
              <DialogHeader>
                <DialogTitle className="font-display text-xl font-bold">
                  Booking request
                </DialogTitle>
                <DialogDescription>
                  Inspect the request, then confirm or decline it.
                </DialogDescription>
              </DialogHeader>

              <div className="mt-4 flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-foreground">
                  {selectedBooking.guestName}
                </span>
                <span
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
                    statusClass(selectedBooking.status),
                  )}
                >
                  {statusLabel[selectedBooking.status] ?? selectedBooking.status}
                </span>
              </div>

              <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
                <div className="flex items-start gap-2">
                  <CalendarDays className="mt-0.5 size-4 text-muted-foreground" />
                  <div>
                    <dt className="text-xs text-muted-foreground">Stay</dt>
                    <dd>
                      {displayDate(selectedBooking.checkIn)} →{" "}
                      {displayDate(selectedBooking.checkOut)}
                    </dd>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <Clock className="mt-0.5 size-4 text-muted-foreground" />
                  <div>
                    <dt className="text-xs text-muted-foreground">Nights</dt>
                    <dd>
                      {Math.max(
                        0,
                        daysBetweenDateOnly(selectedBooking.checkIn, selectedBooking.checkOut),
                      )}
                    </dd>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <Users className="mt-0.5 size-4 text-muted-foreground" />
                  <div>
                    <dt className="text-xs text-muted-foreground">Guests</dt>
                    <dd>{selectedBooking.guests}</dd>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <Mail className="mt-0.5 size-4 text-muted-foreground" />
                  <div className="min-w-0">
                    <dt className="text-xs text-muted-foreground">Email</dt>
                    <dd className="break-all">
                      <a
                        href={`mailto:${selectedBooking.email}`}
                        className="text-primary underline-offset-2 hover:underline"
                      >
                        {selectedBooking.email}
                      </a>
                    </dd>
                  </div>
                </div>
              </dl>

              {selectedBooking.message && (
                <div className="mt-5 rounded-xl bg-muted/50 p-3 text-sm">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <MessageSquare className="size-3.5" /> Message
                  </p>
                  <p className="mt-1 whitespace-pre-wrap">{selectedBooking.message}</p>
                </div>
              )}

              {actionError && (
                <p
                  className="mt-4 rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm font-medium text-destructive"
                  role="alert"
                >
                  {actionError}
                </p>
              )}

              <p className="mt-5 rounded-xl bg-sand px-3 py-2 text-xs text-muted-foreground">
                Confirming is atomic: if another booking already holds these nights, the change is
                refused and the calendar stays unchanged.
              </p>

              <DialogFooter className="mt-5 flex-col gap-2 sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  onClick={() => setSelectedBooking(null)}
                  disabled={processingBookingId !== null}
                >
                  Close
                </Button>
                {selectedBooking.status !== "confirmed" && (
                  <Button
                    type="button"
                    className="min-h-11"
                    onClick={() => void handleBookingStatus(selectedBooking, "confirmed")}
                    disabled={processingBookingId !== null}
                  >
                    {processingBookingId === selectedBooking.id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Check className="size-4" />
                    )}
                    Confirm booking
                  </Button>
                )}
                {selectedBooking.status !== "declined" && (
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 border-destructive/30 text-destructive hover:bg-destructive/5"
                    onClick={() => setDeclineTarget(selectedBooking)}
                    disabled={processingBookingId !== null}
                  >
                    <X className="size-4" />
                    Decline
                  </Button>
                )}
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={unblockTarget !== null}
        onOpenChange={(open) => !open && setUnblockTarget(null)}
      >
        <AlertDialogContent className="max-w-md rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-xl font-bold">
              Unblock these dates?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {unblockTarget
                ? `${displayDate(unblockTarget.start)} → ${displayDate(unblockTarget.end)} will become bookable again.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 gap-2">
            <AlertDialogCancel className="min-h-11">Keep blocked</AlertDialogCancel>
            <AlertDialogAction
              className="min-h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                void handleUnblock();
              }}
              disabled={deletingBlackoutId !== null}
            >
              {deletingBlackoutId ? <Loader2 className="size-4 animate-spin" /> : null}
              Unblock dates
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={declineTarget !== null}
        onOpenChange={(open) => !open && setDeclineTarget(null)}
      >
        <AlertDialogContent className="max-w-md rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-xl font-bold">
              Decline this request?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {declineTarget
                ? `${declineTarget.guestName} · ${displayDate(declineTarget.checkIn)} → ${displayDate(declineTarget.checkOut)}. The request stays in the inbox as declined.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 gap-2">
            <AlertDialogCancel className="min-h-11">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="min-h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                if (declineTarget) void handleBookingStatus(declineTarget, "declined");
              }}
              disabled={processingBookingId !== null}
            >
              {processingBookingId ? <Loader2 className="size-4 animate-spin" /> : null}
              Decline request
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
