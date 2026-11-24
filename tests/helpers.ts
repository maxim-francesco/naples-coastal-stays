import { randomUUID } from "node:crypto";
import { MediaError } from "../src/lib/r2MediaCore";

// Shared fixtures for the media unit tests. Everything here is synthetic and
// exists only inside the test process; nothing is written to an environment
// file and no value is a real credential.

export const SHARED_ENV = {
  R2_ACCESS_KEY_ID: "test-access-key-id",
  R2_SECRET_ACCESS_KEY: "test-secret-access-key",
  R2_BUCKET: "test-bucket",
  R2_ENDPOINT: "https://storage.example.test",
  R2_PUBLIC_BASE_URL: "https://media.example.test",
};

export const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.from("JFIF", "ascii"),
  Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]),
]);

export const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("IHDR", "ascii"),
  Buffer.from([0x00, 0x00, 0x00, 0x0d]),
]);

export const NOT_AN_IMAGE = Buffer.from("<html><body>not an image</body></html>", "utf8");

export async function failure(run: () => unknown | Promise<unknown>): Promise<MediaError> {
  try {
    await run();
  } catch (error) {
    return error as MediaError;
  }
  throw new Error("Expected the call to fail, but it succeeded");
}

export function codeOf(run: () => unknown): string {
  try {
    run();
    return "none";
  } catch (error) {
    return (error as MediaError).code;
  }
}

// A tiny in-memory stand-in for the Supabase PostgREST builder. It records
// every statement, supports the clauses the photo server functions use and can
// fail a chosen statement on demand. It is a test double, not a database: it
// has no constraints and proves nothing about real PostgreSQL behaviour.
type Row = Record<string, unknown>;
type Filter = {
  kind: "eq" | "neq" | "in" | "gt" | "gte" | "lt" | "lte";
  column: string;
  value: unknown;
};
type State = {
  table: string;
  operation: "select" | "insert" | "update" | "delete";
  returning: boolean;
  single: "none" | "maybe" | "exact";
  exactCount: boolean;
  columns: string;
  filters: Filter[];
  orders: Array<{ column: string; ascending: boolean }>;
  payload: unknown;
};
type DbResult = {
  data: unknown;
  error: { message: string; code?: string } | null;
  count: number | null;
};

export function createFakeSupabase() {
  const tables: Record<string, Row[]> = {};
  const log: string[] = [];
  let plannedFailure: { operation: string; message: string; skip: number } | null = null;
  const rpcCalls: Array<{ name: string; args: unknown }> = [];
  const epochDay = (value: unknown): number => {
    const text = String(value);
    return Math.floor(
      Date.UTC(Number(text.slice(0, 4)), Number(text.slice(5, 7)) - 1, Number(text.slice(8, 10))) /
        86_400_000,
    );
  };
  const intersect = (aStart: number, aEnd: number, bStart: number, bEnd: number) =>
    aStart < bEnd && bStart < aEnd;
  const rowsOf = (table: string): Row[] => (tables[table] ??= []);
  const rpcOk = (data: unknown): DbResult => ({ data, error: null, count: null });

  // Simulates the atomic database functions installed by the availability
  // migration, including their conflict checks. The real guarantees are proved
  // by tests/availability.privileges.postgres.test.ts against PostgreSQL.
  const defaultRpc = (name: string, args: unknown): DbResult => {
    if (name === "confirm_booking_request") {
      const p_booking_id = String((args as { p_booking_id?: unknown } | null)?.p_booking_id ?? "");
      const booking = rowsOf("booking_requests").find((row) => row.id === p_booking_id);
      if (!booking) return rpcOk({ ok: false, code: "not_found" });
      if (booking.status === "confirmed") return rpcOk({ ok: true, already: true });
      if (!booking.property_id) return rpcOk({ ok: false, code: "missing_property" });

      const start = epochDay(booking.check_in);
      const end = epochDay(booking.check_out);
      if (end <= start) return rpcOk({ ok: false, code: "invalid_range" });

      const conflictsWithBooking = rowsOf("booking_requests").some(
        (row) =>
          row.id !== booking.id &&
          row.property_id === booking.property_id &&
          row.status === "confirmed" &&
          intersect(start, end, epochDay(row.check_in), epochDay(row.check_out)),
      );
      const conflictsWithBlackout = rowsOf("blackout_dates").some(
        (row) =>
          row.property_id === booking.property_id &&
          intersect(start, end, epochDay(row.start_date), epochDay(row.end_date)),
      );
      if (conflictsWithBooking || conflictsWithBlackout) {
        return rpcOk({ ok: false, code: "conflict" });
      }

      booking.status = "confirmed";
      return rpcOk({ ok: true });
    }

    if (name === "create_blackout") {
      const payload = (args ?? {}) as {
        p_property_id?: unknown;
        p_start?: unknown;
        p_end?: unknown;
        p_note?: unknown;
      };
      const propertyId = payload.p_property_id ? String(payload.p_property_id) : "";
      if (!propertyId) return rpcOk({ ok: false, code: "not_found" });
      if (!payload.p_start || !payload.p_end) return rpcOk({ ok: false, code: "invalid_range" });

      const start = epochDay(payload.p_start);
      const end = epochDay(payload.p_end);
      if (end <= start) return rpcOk({ ok: false, code: "invalid_range" });
      if (!rowsOf("properties").some((row) => row.id === propertyId)) {
        return rpcOk({ ok: false, code: "not_found" });
      }

      const conflictsWithBooking = rowsOf("booking_requests").some(
        (row) =>
          row.property_id === propertyId &&
          row.status === "confirmed" &&
          intersect(start, end, epochDay(row.check_in), epochDay(row.check_out)),
      );
      if (conflictsWithBooking) return rpcOk({ ok: false, code: "booking_conflict" });

      const overlapsBlackout = rowsOf("blackout_dates").some(
        (row) =>
          row.property_id === propertyId &&
          intersect(start, end, epochDay(row.start_date), epochDay(row.end_date)),
      );
      if (overlapsBlackout) return rpcOk({ ok: false, code: "overlap" });

      const id = randomUUID();
      rowsOf("blackout_dates").push({
        id,
        property_id: propertyId,
        start_date: payload.p_start,
        end_date: payload.p_end,
        note: payload.p_note ?? "",
        created_at: new Date().toISOString(),
      });
      return rpcOk({ ok: true, id });
    }

    return {
      data: null,
      error: {
        message: `Could not find the function public.${name} in the schema cache`,
        code: "PGRST202",
      },
      count: null,
    };
  };
  let rpcHandler: (name: string, args: unknown) => DbResult | Promise<DbResult> = defaultRpc;

  const compare = (a: unknown, b: unknown) => {
    if (typeof a === "number" && typeof b === "number") return a - b;
    return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
  };

  const matches = (row: Row, filter: Filter) => {
    const actual = row[filter.column];
    if (filter.kind === "eq") return actual === filter.value;
    if (filter.kind === "neq") return actual !== filter.value;
    if (filter.kind === "in") return Array.isArray(filter.value) && filter.value.includes(actual);
    const order = compare(actual, filter.value);
    if (filter.kind === "gt") return order > 0;
    if (filter.kind === "gte") return order >= 0;
    if (filter.kind === "lt") return order < 0;
    return order <= 0;
  };

  const pick = (row: Row, columns: string) =>
    columns
      .split(/[\s,]+/)
      .filter(Boolean)
      .reduce<Row>((out, column) => {
        out[column] = row[column];
        return out;
      }, {});

  const execute = async (state: State): Promise<DbResult> => {
    const operation = `${state.table}.${state.operation}`;
    log.push(operation);
    if (plannedFailure?.operation === operation) {
      if (plannedFailure.skip > 0) plannedFailure.skip -= 1;
      else {
        const { message } = plannedFailure;
        plannedFailure = null;
        return { data: null, error: { message }, count: null };
      }
    }
    const rows = tables[state.table] ?? (tables[state.table] = []);
    let affected = rows.filter((row) => state.filters.every((filter) => matches(row, filter)));
    const isWrite = state.operation !== "select";
    if (state.operation === "insert") {
      const entries = (Array.isArray(state.payload) ? state.payload : [state.payload]) as Row[];
      affected = entries.map((entry) => ({ id: randomUUID(), ...entry }));
      rows.push(...affected);
    } else if (state.operation === "update") {
      for (const row of affected) Object.assign(row, state.payload as Row);
    } else if (state.operation === "delete") {
      tables[state.table] = rows.filter((row) => !affected.includes(row));
    }
    if (state.operation === "select" && state.exactCount) {
      return { data: null, error: null, count: affected.length };
    }
    if (!isWrite || state.returning) {
      for (const order of [...state.orders].reverse()) {
        affected = [...affected].sort(
          (a, b) => compare(a[order.column], b[order.column]) * (order.ascending ? 1 : -1),
        );
      }
      let data: unknown =
        isWrite || state.columns === "*"
          ? affected
          : affected.map((row) => pick(row, state.columns));
      if (state.single === "maybe") data = affected[0] ?? null;
      if (state.single === "exact") {
        if (affected.length !== 1) {
          return {
            data: null,
            error: {
              message: "JSON object requested, multiple (or no) rows returned",
              code: "PGRST116",
            },
            count: null,
          };
        }
        data = affected[0];
      }
      return { data, error: null, count: null };
    }
    return { data: null, error: null, count: null };
  };

  const builder = (state: State) => {
    const api = {
      select(columns: string = "*", options?: { count?: string; head?: boolean }) {
        if (state.operation === "select") {
          state.columns = columns;
          state.exactCount = options?.count === "exact";
        } else {
          state.returning = true;
        }
        return api;
      },
      insert(payload: unknown) {
        state.operation = "insert";
        state.payload = payload;
        return api;
      },
      update(payload: unknown) {
        state.operation = "update";
        state.payload = payload;
        return api;
      },
      delete() {
        state.operation = "delete";
        return api;
      },
      eq(column: string, value: unknown) {
        state.filters.push({ kind: "eq", column, value });
        return api;
      },
      neq(column: string, value: unknown) {
        state.filters.push({ kind: "neq", column, value });
        return api;
      },
      in(column: string, values: unknown[]) {
        state.filters.push({ kind: "in", column, value: values });
        return api;
      },
      gt(column: string, value: unknown) {
        state.filters.push({ kind: "gt", column, value });
        return api;
      },
      gte(column: string, value: unknown) {
        state.filters.push({ kind: "gte", column, value });
        return api;
      },
      lt(column: string, value: unknown) {
        state.filters.push({ kind: "lt", column, value });
        return api;
      },
      lte(column: string, value: unknown) {
        state.filters.push({ kind: "lte", column, value });
        return api;
      },
      order(column: string, options?: { ascending?: boolean }) {
        state.orders.push({ column, ascending: options?.ascending ?? true });
        return api;
      },
      maybeSingle() {
        state.single = "maybe";
        return execute(state);
      },
      single() {
        state.single = "exact";
        return execute(state);
      },
      then(onFulfilled?: (value: DbResult) => unknown, onRejected?: (reason: unknown) => unknown) {
        return execute(state).then(onFulfilled, onRejected);
      },
    };
    return api;
  };

  const supabaseAdmin = {
    from: (table: string) =>
      builder({
        table,
        operation: "select",
        returning: false,
        single: "none",
        exactCount: false,
        columns: "*",
        filters: [],
        orders: [],
        payload: null,
      }),
    rpc: async (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      log.push(`rpc.${name}`);
      return rpcHandler(name, args);
    },
  };

  return {
    supabaseAdmin,
    tables,
    log,
    rpcCalls,
    setRpcHandler(handler: (name: string, args: unknown) => DbResult | Promise<DbResult>) {
      rpcHandler = handler;
    },
    reset(seed: Record<string, Row[]>) {
      for (const table of Object.keys(tables)) delete tables[table];
      Object.assign(tables, structuredClone(seed));
      log.length = 0;
      rpcCalls.length = 0;
      rpcHandler = defaultRpc;
      plannedFailure = null;
    },
    failNext(operation: string, message: string, skip = 0) {
      plannedFailure = { operation, message, skip };
    },
  };
}
