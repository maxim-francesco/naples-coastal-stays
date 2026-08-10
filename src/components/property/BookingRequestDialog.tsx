import { useMemo, useState } from "react";
import { differenceInCalendarDays, format } from "date-fns";
import type { DateRange } from "react-day-picker";
import { CalendarDays, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { Property } from "@/server/properties";

const currency = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function BookingRequestDialog({
  property,
  range,
  disabledDates,
  className,
}: {
  property: Property;
  range?: DateRange | undefined;
  disabledDates: Date[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [stay, setStay] = useState<DateRange | undefined>(range);
  const [guests, setGuests] = useState("2");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

  const nights =
    stay?.from && stay?.to ? Math.max(0, differenceInCalendarDays(stay.to, stay.from)) : 0;
  const total = useMemo(
    () => (nights > 0 ? nights * property.baseRate + property.cleaningFee : 0),
    [nights, property.baseRate, property.cleaningFee],
  );
  const belowMinimum = nights > 0 && nights < property.minNights;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!stay?.from || !stay?.to || belowMinimum) {
      toast.error(`Please choose dates of at least ${property.minNights} nights.`);
      return;
    }
    setSubmitted(true);
    toast.success("Request sent — we'll reply within 24 hours.");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSubmitted(false);
      }}
    >
      <DialogTrigger asChild>
        <Button size="lg" className={cn("w-full rounded-full", className)}>
          Request to book
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto rounded-2xl sm:max-w-lg">
        {submitted ? (
          <div className="py-6 text-center">
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-accent">
              <Check className="size-5 text-primary" />
            </div>
            <DialogHeader className="mt-5">
              <DialogTitle className="text-center font-display text-2xl">
                Request received
              </DialogTitle>
              <DialogDescription className="text-center">
                Thank you, {name || "friend"}. We've noted {nights} nights at {property.name} and
                will confirm availability by email shortly.
              </DialogDescription>
            </DialogHeader>
            <Button className="mt-6 rounded-full" onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle className="font-display text-2xl">Request to book</DialogTitle>
              <DialogDescription>
                {property.name} · {property.minNights}-night minimum. No payment now.
              </DialogDescription>
            </DialogHeader>

            <div className="mt-6 space-y-5">
              <div className="space-y-2">
                <Label>Dates</Label>
                <div className="rounded-2xl border border-border bg-card p-2">
                  <Calendar
                    mode="range"
                    selected={stay}
                    onSelect={setStay}
                    numberOfMonths={1}
                    disabled={[{ before: new Date() }, ...disabledDates]}
                    className="pointer-events-auto mx-auto"
                  />
                </div>
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <CalendarDays className="size-3.5" />
                  {stay?.from
                    ? `${format(stay.from, "MMM d, yyyy")} → ${stay.to ? format(stay.to, "MMM d, yyyy") : "select checkout"}`
                    : "Select your arrival and departure"}
                </p>
                {belowMinimum && (
                  <p className="text-xs text-destructive">
                    Minimum stay is {property.minNights} nights.
                  </p>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="guests">Guests</Label>
                  <Select value={guests} onValueChange={setGuests}>
                    <SelectTrigger id="guests" className="rounded-xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: property.maxGuests }, (_, i) => i + 1).map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n} {n === 1 ? "guest" : "guests"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="rounded-xl"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="rounded-xl"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="message">Message (optional)</Label>
                <Textarea
                  id="message"
                  rows={3}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="rounded-xl"
                  placeholder="Tell the host a little about your trip."
                />
              </div>

              <div className="rounded-2xl bg-sand p-4 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>
                    {currency(property.baseRate)} × {nights || 0} nights
                  </span>
                  <span>{currency(nights * property.baseRate)}</span>
                </div>
                <div className="mt-2 flex justify-between text-muted-foreground">
                  <span>Cleaning fee</span>
                  <span>{currency(nights > 0 ? property.cleaningFee : 0)}</span>
                </div>
                <div className="mt-3 flex justify-between border-t border-border pt-3 font-medium">
                  <span>Estimated total</span>
                  <span>{currency(total)}</span>
                </div>
              </div>

              <Button type="submit" size="lg" className="w-full rounded-full">
                Send request
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
