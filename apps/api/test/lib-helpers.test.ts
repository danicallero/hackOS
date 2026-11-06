import { describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.js";
import { csvCell, toCsv } from "../src/lib/csv.js";
import { isUniqueViolation } from "../src/lib/db-errors.js";
import { contentDisposition } from "../src/lib/http-headers.js";
import { escapeLike, likeContains } from "../src/lib/like.js";
import { isProbePath, pathMatchesPrefix, pathOf } from "../src/lib/request-path.js";
import { idParam, idParams } from "../src/lib/schemas.js";
import { fixtureSideSql, liveUserSql, sameFixtureSideSql } from "../src/lib/sql-predicates.js";
import { createUser, useTestApp } from "./helpers.js";

useTestApp();

describe("csv", () => {
  it("quotes cells holding a delimiter, quote, newline or bare carriage return", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('a"b')).toBe('"a""b"');
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell("a\nb")).toBe('"a\nb"');
    expect(csvCell("a\rb")).toBe('"a\rb"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(new Date("2026-01-02T03:04:05Z"))).toBe("2026-01-02T03:04:05.000Z");
  });

  it("renders a BOM-prefixed CRLF document", () => {
    expect(toCsv(["a", "b"], [["x\ry", 1]])).toBe('﻿a,b\r\n"x\ry",1\r\n');
  });
});

describe("contentDisposition", () => {
  it("leaves safe ASCII names untouched", () => {
    expect(contentDisposition("meal-plan-12.csv")).toBe('attachment; filename="meal-plan-12.csv"');
  });

  it("drops characters that could break out of the header", () => {
    expect(contentDisposition('a"b\\c/d;e\r\nf.csv')).toBe('attachment; filename="abcdef.csv"');
    expect(contentDisposition("../..")).toBe('attachment; filename="...."');
    expect(contentDisposition("")).toBe('attachment; filename="download"');
  });

  it("adds an RFC 5987 name for non-ASCII filenames", () => {
    expect(contentDisposition("año.csv")).toBe(
      `attachment; filename="a_o.csv"; filename*=UTF-8''a%C3%B1o.csv`,
    );
  });
});

describe("isUniqueViolation", () => {
  it("matches only 23505, optionally for one constraint", () => {
    expect(isUniqueViolation({ code: "23505", constraint: "users_email_key" })).toBe(true);
    expect(isUniqueViolation({ code: "23505", constraint: "users_email_key" }, "x")).toBe(false);
    expect(isUniqueViolation({ code: "23505", constraint: "x" }, "x")).toBe(true);
    expect(isUniqueViolation({ code: "23503" })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });

  it("recognises a real unique violation", async () => {
    const email = `dup-${crypto.randomUUID()}@test.local`;
    await createUser({ email });
    const err = await createUser({ email }).catch((e) => e);
    expect(isUniqueViolation(err)).toBe(true);
  });
});

describe("like escaping", () => {
  it("escapes wildcards so they match literally", async () => {
    expect(escapeLike("50%_off\\")).toBe("50\\%\\_off\\\\");
    expect(likeContains("a_b")).toBe("%a\\_b%");
    const { rows } = await pool.query(
      `SELECT 'a_b' ILIKE $1 AS literal, 'axb' ILIKE $1 AS wildcard, '100%' ILIKE $2 AS percent, '1000' ILIKE $2 AS any`,
      [likeContains("a_b"), likeContains("100%")],
    );
    expect(rows[0]).toEqual({ literal: true, wildcard: false, percent: true, any: false });
  });
});

describe("request paths", () => {
  it("strips the query string and recognises probes and prefixes", () => {
    expect(pathOf("/api/me?x=1")).toBe("/api/me");
    expect(pathOf("/api/me")).toBe("/api/me");
    expect(isProbePath("/healthz")).toBe(true);
    expect(isProbePath("/api/healthz")).toBe(false);
    expect(pathMatchesPrefix("/api/me/x", "/api/me")).toBe(true);
    expect(pathMatchesPrefix("/api/mex", "/api/me")).toBe(false);
  });
});

describe("id param schemas", () => {
  it("coerce positive integers and reject the rest", () => {
    expect(idParams.parse({ id: "7" })).toEqual({ id: 7 });
    expect(idParam("roomId").parse({ roomId: "3" })).toEqual({ roomId: 3 });
    expect(() => idParams.parse({ id: "0" })).toThrow();
    expect(() => idParams.parse({ id: "1.5" })).toThrow();
    expect(() => idParams.parse({ id: "abc" })).toThrow();
  });
});

describe("sql predicates", () => {
  it("liveUserSql keeps only active, non-anonymized accounts", async () => {
    const live = await createUser();
    const pending = await createUser();
    const anonymized = await createUser();
    await pool.query(`UPDATE users SET account_state = 'removal_pending' WHERE id = $1`, [pending]);
    await pool.query(`UPDATE users SET anonymized_at = now() WHERE id = $1`, [anonymized]);
    const { rows } = await pool.query(`SELECT u.id FROM users u WHERE ${liveUserSql("u")}`);
    expect(rows.map((r) => r.id)).toEqual([live]);
  });

  it("fixture helpers partition by is_test_account", async () => {
    const real = await createUser();
    const synthetic = await createUser();
    await pool.query(`UPDATE users SET is_test_account = true WHERE id = $1`, [synthetic]);
    const ids = async (where: string) =>
      (await pool.query(`SELECT u.id FROM users u WHERE ${where}`)).rows.map((r) => r.id);
    expect(await ids(fixtureSideSql("u", false))).toEqual([real]);
    expect(await ids(fixtureSideSql("u", true))).toEqual([synthetic]);
    const { rows } = await pool.query(
      `SELECT a.id AS a, b.id AS b FROM users a JOIN users b ON ${sameFixtureSideSql("a", "b")} AND a.id = b.id`,
    );
    expect(rows).toHaveLength(2);
  });

  it("rejects aliases that are not plain identifiers", () => {
    expect(() => liveUserSql("u; DROP TABLE users")).toThrow();
    expect(() => fixtureSideSql("1u", true)).toThrow();
  });
});
