import { afterAll, afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { join } from "node:path";

// Contract tests for the server-side admin guard. The request object and the
// Supabase Auth lookup are in-memory doubles; the guard itself is the real
// module. Nothing here reaches the network, a database or a real session.

const lib = join(import.meta.dir, "..", "src", "lib");

const TOKEN = "valid-session-token";
const ADMIN_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const ORDINARY_ID = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";

let authorization: string | null = null;
mock.module("@tanstack/react-start/server", () => ({
  getRequest: () => ({
    headers: new Headers(authorization ? { Authorization: authorization } : {}),
  }),
}));

const auth = { userId: ADMIN_ID, error: null as string | null, tokenValid: true };
mock.module(join(lib, "supabase.server.ts"), () => ({
  supabase: {
    auth: {
      getUser: async (token: string) =>
        auth.tokenValid && token === TOKEN
          ? { data: { user: { id: auth.userId } }, error: null }
          : { data: { user: null }, error: { message: auth.error ?? "invalid token" } },
    },
  },
}));

const { AdminAccessError, adminErrorMessage, requireAdmin } =
  await import("../src/lib/authGuard.server");

const signIn = (token: string | null = TOKEN) => {
  authorization = token ? `Bearer ${token}` : null;
};

const failureOf = async (run: () => Promise<unknown>): Promise<string | null> => {
  try {
    await run();
    return null;
  } catch (e) {
    return e instanceof AdminAccessError ? e.failure : `unexpected:${String(e)}`;
  }
};

const errorLog: string[] = [];
let errorSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  errorLog.length = 0;
  errorSpy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errorLog.push(args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(" "));
  });
  auth.userId = ADMIN_ID;
  auth.error = null;
  auth.tokenValid = true;
  process.env["ADMIN_USER_IDS"] = ADMIN_ID;
  signIn();
});

afterEach(() => {
  errorSpy.mockRestore();
});

afterAll(() => {
  delete process.env["ADMIN_USER_IDS"];
  mock.restore();
});

describe("administrator configuration", () => {
  test("a missing allowlist denies even a valid session", async () => {
    delete process.env["ADMIN_USER_IDS"];
    expect(await failureOf(() => requireAdmin())).toBe("not_configured");
    expect(await failureOf(() => requireAdmin(TOKEN))).toBe("not_configured");
    expect(errorLog.join("\n")).toContain("ADMIN_USER_IDS");
  });

  test("an empty or whitespace-only allowlist denies access", async () => {
    for (const value of ["", "   ", ",", " , , "]) {
      process.env["ADMIN_USER_IDS"] = value;
      expect(await failureOf(() => requireAdmin()), JSON.stringify(value)).toBe("not_configured");
    }
  });

  test("the allowlist accepts comma- or whitespace-separated ids and ignores case", async () => {
    process.env["ADMIN_USER_IDS"] = `${ORDINARY_ID}, ${ADMIN_ID.toUpperCase()}`;
    expect((await requireAdmin()).id).toBe(ADMIN_ID);

    process.env["ADMIN_USER_IDS"] = `${ORDINARY_ID}\n${ADMIN_ID}`;
    expect((await requireAdmin()).id).toBe(ADMIN_ID);
  });
});

describe("session verification", () => {
  test("no token anywhere is unauthenticated", async () => {
    signIn(null);
    expect(await failureOf(() => requireAdmin())).toBe("unauthorized");
  });

  test("a malformed Authorization header is unauthenticated", async () => {
    for (const header of ["Token abc", "Bearer", "Basic abc", "Bearer  two tokens"]) {
      authorization = header;
      expect(await failureOf(() => requireAdmin()), header).toBe("unauthorized");
    }
  });

  test("the bearer scheme is case-insensitive", async () => {
    authorization = `bearer ${TOKEN}`;
    expect((await requireAdmin()).id).toBe(ADMIN_ID);
  });

  test("a token Supabase rejects is unauthenticated", async () => {
    auth.tokenValid = false;
    expect(await failureOf(() => requireAdmin(TOKEN))).toBe("unauthorized");
  });

  test("the explicit token used by the existing server functions is accepted", async () => {
    signIn(null);
    expect((await requireAdmin(TOKEN)).id).toBe(ADMIN_ID);
  });
});

describe("authorization", () => {
  test("an authenticated user who is not on the allowlist is forbidden", async () => {
    auth.userId = ORDINARY_ID;
    expect(await failureOf(() => requireAdmin(TOKEN))).toBe("forbidden");
    expect(await failureOf(() => requireAdmin())).toBe("forbidden");
    expect(errorLog.join("\n")).toContain(ORDINARY_ID);
  });

  test("an allowlisted user is returned", async () => {
    expect((await requireAdmin()).id).toBe(ADMIN_ID);
  });
});

describe("error surface", () => {
  test("only the guard's own messages are passed through", () => {
    expect(
      adminErrorMessage(new AdminAccessError("unauthorized", "Unauthorized"), "fallback"),
    ).toBe("Unauthorized");
    expect(adminErrorMessage(new AdminAccessError("forbidden", "Forbidden"), "fallback")).toBe(
      "Forbidden",
    );
  });

  test("database and network errors are replaced by the caller's message", () => {
    expect(
      adminErrorMessage(new Error("duplicate key value violates constraint"), "fallback"),
    ).toBe("fallback");
    expect(adminErrorMessage({ message: "connection refused" }, "fallback")).toBe("fallback");
    expect(adminErrorMessage(null, "fallback")).toBe("fallback");
  });
});
