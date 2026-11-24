"use client";

import { useMemo, useState } from "react";
import { addMonths, format, startOfMonth } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  blockedDateSet,
  dateOnlyToLocalDate,
  daysBetweenDateOnly,
  eachDateOnly,
  findAvailabilityConflict,
  type AvailabilityRange,
} from "@/lib/availability";

export interface StaySelection {
  checkIn: string | null;
  checkOut: string | null;
}

interface StayCalendarProps {
  unavailableDates: AvailabilityRange[];
  today: string;
  selection: StaySelection;
  onSelectionChange: (selection: StaySelection) => void;
  numberOfMonths?: 1 | 2;
  className?: string;
}

interface MonthPanelProps {
  monthDate: Date;
  today: string;
  blocked: Set<string>;
  selection: StaySelection;
  onSelect: (day: string) => void;
  showCaption: boolean;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function monthDateFromValue(value: string): Date {
  const date = dateOnlyToLocalDate(value);
  return startOfMonth(date);
}

function monthCells(monthDate: Date): (string | null)[] {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = Array.from({ length: first.getDay() }, () => null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateOnly = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    cells.push(dateOnly);
  }
  return cells;
}

function displayDay(value: string) {
  return format(dateOnlyToLocalDate(value), "EEE, MMM d");
}

function MonthPanel({
  monthDate,
  today,
  blocked,
  selection,
  onSelect,
  showCaption,
}: MonthPanelProps) {
  const cells = useMemo(() => monthCells(monthDate), [monthDate]);
  const { checkIn, checkOut } = selection;

  return (
    <div className="min-w-0">
      {showCaption && (
        <p className="mb-2 hidden text-center text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase min-[1160px]:block">
          {format(monthDate, "MMMM yyyy")}
        </p>
      )}
      <div className="grid grid-cols-7" role="grid" aria-label={format(monthDate, "MMMM yyyy")}>
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
          const isBlocked = blocked.has(day);
          const isStart = checkIn === day;
          const isEnd = checkOut === day;
          const inRange = Boolean(checkIn && checkOut && day > checkIn && day < checkOut);
          const canChooseAsCheckout =
            Boolean(checkIn) &&
            !checkOut &&
            day > (checkIn as string) &&
            !eachDateOnly(checkIn as string, day).some((night) => blocked.has(night)) &&
            !isPast;

          const interactive = !isPast && (!isBlocked || canChooseAsCheckout);
          const selected = isStart || isEnd;

          let label = `${format(dateOnlyToLocalDate(day), "EEEE, MMMM d, yyyy")} — available`;
          if (isPast) label = `${format(dateOnlyToLocalDate(day), "EEEE, MMMM d, yyyy")} — past`;
          else if (isBlocked && !canChooseAsCheckout) {
            label = `${format(dateOnlyToLocalDate(day), "EEEE, MMMM d, yyyy")} — booked, unavailable`;
          } else if (isBlocked && canChooseAsCheckout) {
            label = `${format(dateOnlyToLocalDate(day), "EEEE, MMMM d, yyyy")} — checkout available, booked that night`;
          }
          if (isStart) label = `${displayDay(day)} — selected check-in`;
          if (isEnd) label = `${displayDay(day)} — selected check-out`;

          return (
            <div key={day} className="min-w-0">
              <button
                type="button"
                onClick={() => onSelect(day)}
                aria-label={label}
                aria-pressed={selected}
                aria-disabled={!interactive}
                className={cn(
                  "relative flex h-11 min-h-11 w-full min-w-0 items-center justify-center rounded-xl text-[13px] font-medium transition-colors sm:text-sm",
                  "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:outline-none",
                  isPast && "cursor-not-allowed text-muted-foreground/35",
                  !isPast && !isBlocked && !selected && "text-foreground hover:bg-sand",
                  isBlocked &&
                    !selected &&
                    !canChooseAsCheckout &&
                    "cursor-not-allowed bg-sand-deep/45 text-muted-foreground/70",
                  isBlocked &&
                    canChooseAsCheckout &&
                    !selected &&
                    "bg-sand-deep/45 text-muted-foreground ring-1 ring-primary/40 ring-inset hover:bg-sand",
                  inRange && "rounded-none bg-primary/10 text-primary-strong",
                  isStart && "rounded-full bg-primary text-primary-foreground shadow-sm",
                  isEnd && "rounded-full bg-primary text-primary-foreground shadow-sm",
                  day === today && !selected && "ring-1 ring-primary/35 ring-inset",
                )}
              >
                {Number(day.slice(8, 10))}
                {isBlocked && !selected && (
                  <span
                    aria-hidden="true"
                    className="absolute bottom-1 size-1 rounded-full bg-primary/35"
                  />
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function StayCalendar({
  unavailableDates,
  today,
  selection,
  onSelectionChange,
  numberOfMonths = 1,
  className,
}: StayCalendarProps) {
  const currentMonth = useMemo(() => monthDateFromValue(today), [today]);
  const [monthDate, setMonthDate] = useState(() => currentMonth);
  const [hint, setHint] = useState<string | null>(null);
  const blocked = useMemo(() => blockedDateSet(unavailableDates), [unavailableDates]);

  const canGoBack = monthDate > currentMonth;
  const months = Array.from({ length: numberOfMonths }, (_, index) => addMonths(monthDate, index));

  const handleSelect = (day: string) => {
    setHint(null);
    const { checkIn, checkOut } = selection;
    const isBlocked = blocked.has(day);

    if (day < today) {
      setHint("Choose a date from today onward.");
      return;
    }

    if (!checkIn || checkOut) {
      if (isBlocked) {
        setHint("Those nights are already booked. Try another date.");
        return;
      }
      onSelectionChange({ checkIn: day, checkOut: null });
      return;
    }

    if (day <= checkIn) {
      if (isBlocked) {
        setHint("Those nights are already booked. Try another date.");
        return;
      }
      onSelectionChange({ checkIn: day, checkOut: null });
      return;
    }

    const conflict = findAvailabilityConflict({ start: checkIn, end: day }, unavailableDates);
    if (conflict) {
      setHint(
        `Those dates overlap a booked stay (${format(dateOnlyToLocalDate(conflict.start), "MMM d")} – ${format(dateOnlyToLocalDate(conflict.end), "MMM d")}). Choose a shorter or different range.`,
      );
      return;
    }

    onSelectionChange({ checkIn, checkOut: day });
  };

  const nights =
    selection.checkIn && selection.checkOut
      ? Math.max(0, daysBetweenDateOnly(selection.checkIn, selection.checkOut))
      : 0;

  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setMonthDate((current) => addMonths(current, -1))}
          disabled={!canGoBack}
          aria-label="Previous month"
          className="inline-flex size-11 items-center justify-center rounded-full border border-border bg-card text-foreground transition-colors hover:bg-sand disabled:pointer-events-none disabled:opacity-35"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
        </button>

        <p className="min-w-0 text-center font-display text-lg font-semibold tracking-tight text-foreground sm:text-xl">
          {numberOfMonths === 1 ? (
            format(monthDate, "MMMM yyyy")
          ) : (
            <>
              <span className="min-[1160px]:hidden">{format(monthDate, "MMMM yyyy")}</span>
              <span className="hidden min-[1160px]:inline">
                {format(monthDate, "MMM")} – {format(addMonths(monthDate, 1), "MMM yyyy")}
              </span>
            </>
          )}
        </p>

        <button
          type="button"
          onClick={() => setMonthDate((current) => addMonths(current, 1))}
          aria-label="Next month"
          className="inline-flex size-11 items-center justify-center rounded-full border border-border bg-card text-foreground transition-colors hover:bg-sand"
        >
          <ChevronRight className="size-4" aria-hidden="true" />
        </button>
      </div>

      <div
        className={cn(
          "mx-auto mt-3 grid w-full max-w-[400px] gap-x-3 gap-y-5",
          numberOfMonths === 2 && "min-[1160px]:max-w-none min-[1160px]:grid-cols-2",
        )}
      >
        {months.map((month, index) => (
          <div
            key={format(month, "yyyy-MM")}
            className={index === 1 ? "hidden min-[1160px]:block" : undefined}
          >
            <MonthPanel
              monthDate={month}
              today={today}
              blocked={blocked}
              selection={selection}
              onSelect={handleSelect}
              showCaption={numberOfMonths === 2}
            />
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full border border-border bg-card" aria-hidden="true" />
          Available
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-sand-deep" aria-hidden="true" />
          Booked
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-primary" aria-hidden="true" />
          Your stay
        </span>
        {nights > 0 && (
          <span className="ml-auto font-medium text-foreground">
            {nights} {nights === 1 ? "night" : "nights"}
          </span>
        )}
      </div>

      <p
        className="mt-2 min-h-5 text-xs font-medium text-destructive"
        role="status"
        aria-live="polite"
      >
        {hint}
      </p>
    </div>
  );
}

export function defaultStaySelection(): StaySelection {
  return { checkIn: null, checkOut: null };
}

export function selectionToRange(selection: StaySelection): AvailabilityRange | null {
  if (!selection.checkIn || !selection.checkOut) return null;
  if (selection.checkOut <= selection.checkIn) return null;
  return { start: selection.checkIn, end: selection.checkOut };
}

export function selectionNights(selection: StaySelection): number {
  const range = selectionToRange(selection);
  if (!range) return 0;
  return Math.max(0, daysBetweenDateOnly(range.start, range.end));
}
