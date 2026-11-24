"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { CalendarDays, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  StayCalendar,
  selectionNights,
  selectionToRange,
  type StaySelection,
} from "./StayCalendar";
import type { Property } from "@/lib/properties.server";
import { submitBookingRequest } from "@/lib/bookings.server";
import {
  dateOnlyToLocalDate,
  findAvailabilityConflict,
  validateStayRequest,
  type AvailabilityRange,
} from "@/lib/availability";

const currency = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function displayDate(value: string | null) {
  if (!value) return "—";
  return format(dateOnlyToLocalDate(value), "MMM d, yyyy");
}

interface BookingRequestDialogProps {
  property: Property;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selection: StaySelection;
  onSelectionChange: (selection: StaySelection) => void;
  guests: number;
  onGuestsChange: (guests: number) => void;
  today: string;
  unavailableDates: AvailabilityRange[];
  onAvailabilityRefresh?: () => void;
}

export function BookingRequestDialog({
  property,
  open,
  onOpenChange,
  selection,
  onSelectionChange,
  guests,
  onGuestsChange,
  today,
  unavailableDates,
  onAvailabilityRefresh,
}: BookingRequestDialogProps) {
  const [submitted, setSubmitted] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const range = selectionToRange(selection);
  const nights = selectionNights(selection);

  useEffect(() => {
    if (open) setFormError(null);
  }, [open]);

  const conflict = useMemo(
    () => (range ? findAvailabilityConflict(range, unavailableDates) : null),
    [range, unavailableDates],
  );

  const validation = useMemo(
    () =>
      range
        ? validateStayRequest({
            checkIn: range.start,
            checkOut: range.end,
            guests,
            maxGuests: property.maxGuests,
            minNights: property.minNights,
            today,
            unavailable: unavailableDates,
          })
        : null,
    [range, guests, property.maxGuests, property.minNights, today, unavailableDates],
  );

  const belowMinimum = validation?.ok === false && validation.code === "min_nights";
  const invalidRange = validation?.ok === false && validation.code !== "min_nights";
  const estimate =
    validation?.ok === true ? nights * property.baseRate + property.cleaningFee : null;
  const canSubmit = Boolean(range) && validation?.ok === true && !submitting;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);

    if (!range) {
      setFormError("Select your check-in and check-out dates.");
      return;
    }
    if (!validation || !validation.ok) {
      setFormError(validation?.ok === false ? validation.message : "Choose a valid date range.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await submitBookingRequest({
        data: {
          property_id: property.id,
          guest_name: name.trim(),
          email: email.trim(),
          check_in: range.start,
          check_out: range.end,
          guests,
          message: message.trim(),
          website,
        },
      });

      if (result.ok) {
        setSubmitted(true);
        onAvailabilityRefresh?.();
        toast.success("Request sent — we'll reply within 24 hours.");
      } else {
        setFormError(result.error || "Could not send your request. Please try again.");
        onAvailabilityRefresh?.();
      }
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Something went wrong. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenChange = (next: boolean) => {
    if (submitting) return;
    onOpenChange(next);
    if (!next) {
      setSubmitted(false);
      setFormError(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-sm:inset-x-0 max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:max-h-[94dvh] max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-t-[28px] max-sm:rounded-b-none max-sm:border-b-0 max-sm:p-0 sm:max-w-lg sm:rounded-3xl sm:p-0"
        onOpenAutoFocus={() => {
          returnFocusRef.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }}
        onCloseAutoFocus={(event) => {
          const target = returnFocusRef.current;
          if (target && document.contains(target)) {
            event.preventDefault();
            target.focus();
          }
          returnFocusRef.current = null;
        }}
      >
        <div className="flex max-h-[94dvh] flex-col sm:max-h-[90vh]">
          <div className="border-b border-border px-5 pt-6 pb-4 sm:border-b-0 sm:pt-7">
            <DialogHeader>
              <p className="eyebrow text-left">Request to book</p>
              <DialogTitle className="mt-1 text-left font-display text-2xl font-semibold tracking-tight sm:text-3xl">
                {submitted ? "Request received" : property.name}
              </DialogTitle>
              <DialogDescription className="text-left">
                {submitted
                  ? "Your dates are pending the host's confirmation. No payment has been taken."
                  : `${property.minNights}-night minimum · No payment now · Reply within 24 hours`}
              </DialogDescription>
            </DialogHeader>
          </div>

          {submitted ? (
            <div className="overflow-y-auto px-5 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:pb-7">
              <div className="rounded-3xl border border-primary/20 bg-primary/5 p-5">
                <div className="flex items-center gap-3">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Check className="size-5" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="font-display text-lg font-semibold">Pending confirmation</p>
                    <p className="text-sm text-muted-foreground">
                      {displayDate(selection.checkIn)} → {displayDate(selection.checkOut)}
                    </p>
                  </div>
                </div>
                <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-primary/15 pt-4 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Nights</dt>
                    <dd className="mt-0.5 font-medium">{nights}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Guests</dt>
                    <dd className="mt-0.5 font-medium">
                      {guests} {guests === 1 ? "guest" : "guests"}
                    </dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-xs text-muted-foreground">Estimated total</dt>
                    <dd className="mt-0.5 font-display text-xl font-semibold">
                      {estimate === null ? "—" : currency(estimate)}
                    </dd>
                  </div>
                </dl>
              </div>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                We&apos;ve noted your request for {property.name}. The host will review it and reply
                by email. These dates are not blocked until the booking is confirmed.
              </p>
              <Button
                type="button"
                size="lg"
                className="mt-6 w-full rounded-full"
                onClick={() => handleOpenChange(false)}
              >
                Close
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="px-1.5 pt-3 sm:px-6 sm:pt-1">
                  <StayCalendar
                    unavailableDates={unavailableDates}
                    today={today}
                    selection={selection}
                    onSelectionChange={onSelectionChange}
                    numberOfMonths={1}
                  />
                </div>

                <div className="space-y-4 px-5 pt-2 pb-5">
                  <div className="grid grid-cols-2 gap-3 rounded-2xl border border-border bg-card p-3">
                    <div>
                      <p className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                        Check-in
                      </p>
                      <p className="mt-1 flex items-center gap-1.5 text-sm font-medium">
                        <CalendarDays className="size-3.5 text-primary" aria-hidden="true" />
                        {displayDate(selection.checkIn)}
                      </p>
                    </div>
                    <div className="border-l border-border pl-3">
                      <p className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                        Check-out
                      </p>
                      <p className="mt-1 flex items-center gap-1.5 text-sm font-medium">
                        <CalendarDays className="size-3.5 text-primary" aria-hidden="true" />
                        {displayDate(selection.checkOut)}
                      </p>
                    </div>
                  </div>

                  {belowMinimum && (
                    <p className="rounded-xl bg-sand px-3 py-2 text-xs font-medium text-foreground">
                      Minimum stay is {property.minNights} nights. Add {property.minNights - nights}{" "}
                      more {property.minNights - nights === 1 ? "night" : "nights"} to continue.
                    </p>
                  )}
                  {invalidRange && !conflict && (
                    <p className="text-xs font-medium text-destructive" role="status">
                      {validation?.ok === false ? validation.message : null}
                    </p>
                  )}
                  {conflict && (
                    <p
                      className="rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs font-medium text-destructive"
                      role="status"
                    >
                      Those dates overlap a booked stay. Please choose another range.
                    </p>
                  )}
                  {!range && (
                    <p className="text-xs text-muted-foreground">
                      Select your arrival and departure dates in the calendar above.
                    </p>
                  )}

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="booking-guests">Guests</Label>
                      <Select
                        value={String(guests)}
                        onValueChange={(value) => onGuestsChange(Number(value))}
                      >
                        <SelectTrigger id="booking-guests" className="min-h-11 rounded-xl">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Array.from({ length: property.maxGuests }, (_, index) => index + 1).map(
                            (count) => (
                              <SelectItem key={count} value={String(count)}>
                                {count} {count === 1 ? "guest" : "guests"}
                              </SelectItem>
                            ),
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="booking-name">Name</Label>
                      <Input
                        id="booking-name"
                        required
                        autoComplete="name"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        className="min-h-11 rounded-xl"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="booking-email">Email</Label>
                    <Input
                      id="booking-email"
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      className="min-h-11 rounded-xl"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="booking-message">Message (optional)</Label>
                    <Textarea
                      id="booking-message"
                      rows={3}
                      value={message}
                      onChange={(event) => setMessage(event.target.value)}
                      className="rounded-xl"
                      placeholder="Tell the host a little about your trip."
                    />
                  </div>

                  <div className="absolute -left-[9999px] opacity-0" aria-hidden="true">
                    <input
                      type="text"
                      name="website"
                      tabIndex={-1}
                      autoComplete="off"
                      value={website}
                      onChange={(event) => setWebsite(event.target.value)}
                    />
                  </div>

                  {estimate !== null && (
                    <div className="rounded-2xl bg-sand p-4 text-sm">
                      <div className="flex justify-between text-muted-foreground">
                        <span>
                          {currency(property.baseRate)} × {nights}{" "}
                          {nights === 1 ? "night" : "nights"}
                        </span>
                        <span>{currency(nights * property.baseRate)}</span>
                      </div>
                      <div className="mt-2 flex justify-between text-muted-foreground">
                        <span>Cleaning fee</span>
                        <span>{currency(property.cleaningFee)}</span>
                      </div>
                      <div className="mt-3 flex justify-between border-t border-border pt-3 font-semibold">
                        <span>Estimated total</span>
                        <span>{currency(estimate)}</span>
                      </div>
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        Estimate only, based on the property&apos;s nightly rate and cleaning fee.
                      </p>
                    </div>
                  )}

                  {formError && (
                    <p
                      className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm font-medium text-destructive"
                      role="alert"
                    >
                      {formError}
                    </p>
                  )}
                </div>
              </div>

              <div className="border-t border-border bg-background px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:rounded-b-3xl">
                <Button
                  type="submit"
                  size="lg"
                  className="w-full rounded-full"
                  disabled={!canSubmit}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      Sending request…
                    </>
                  ) : (
                    "Send request"
                  )}
                </Button>
                <p className="mt-2 text-center text-[11px] text-muted-foreground">
                  No payment is taken. The host confirms availability by email.
                </p>
              </div>
            </form>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
