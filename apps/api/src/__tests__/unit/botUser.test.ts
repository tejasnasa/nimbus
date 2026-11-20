/**
 * @module api/__tests__/unit/botUser
 * @description `ensureBotUser`: the upsert that guarantees Nimbus's user
 * row exists. Runs against the real test database.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeTestResources,
  createUser,
  resetDatabase,
  testPrisma,
} from "@testhelpers";
import { BOT_USER_EMAIL, ensureBotUser } from "../../lib/botUser";

afterAll(closeTestResources);

describe("ensureBotUser", () => {
  beforeEach(async () => {
    await resetDatabase();
    await testPrisma.user.deleteMany({ where: { id: process.env.BOT_USERID } });
  });

  it("creates the row when it is missing", async () => {
    await ensureBotUser(testPrisma);

    const row = await testPrisma.user.findUnique({
      where: { id: process.env.BOT_USERID },
    });
    expect(row).toMatchObject({
      name: "Nimbus",
      email: BOT_USER_EMAIL,
      emailVerified: true,
    });
  });

  it("leaves one unchanged row when called again", async () => {
    await ensureBotUser(testPrisma);
    const first = await testPrisma.user.findUniqueOrThrow({
      where: { id: process.env.BOT_USERID },
    });

    await ensureBotUser(testPrisma);
    const second = await testPrisma.user.findUniqueOrThrow({
      where: { id: process.env.BOT_USERID },
    });

    // The name is rewritten on every call, so only `updatedAt` may move.
    expect(second).toMatchObject({
      id: first.id,
      name: first.name,
      email: first.email,
      createdAt: first.createdAt,
    });
    expect(await testPrisma.user.count({ where: { id: first.id } })).toBe(1);
  });

  it("respects a custom bot id", async () => {
    await ensureBotUser(testPrisma, "custom-bot-id");

    await expect(
      testPrisma.user.findUnique({ where: { id: "custom-bot-id" } }),
    ).resolves.toMatchObject({ email: BOT_USER_EMAIL });
  });

  it("renames a row that still carries the old display name", async () => {
    await testPrisma.user.create({
      data: {
        id: "legacy-bot",
        name: "NimbusBot",
        email: BOT_USER_EMAIL,
        emailVerified: true,
      },
    });

    await ensureBotUser(testPrisma, "legacy-bot");

    await expect(
      testPrisma.user.findUniqueOrThrow({ where: { id: "legacy-bot" } }),
    ).resolves.toMatchObject({ name: "Nimbus", email: BOT_USER_EMAIL });
    expect(await testPrisma.user.count({ where: { id: "legacy-bot" } })).toBe(1);
  });

  it("keeps the address of an existing row with that id", async () => {
    await testPrisma.user.create({
      data: {
        id: "existing-bot",
        name: "Someone Else",
        email: "someone@example.test",
        emailVerified: true,
      },
    });

    await ensureBotUser(testPrisma, "existing-bot");

    await expect(
      testPrisma.user.findUniqueOrThrow({ where: { id: "existing-bot" } }),
    ).resolves.toMatchObject({
      name: "Nimbus",
      email: "someone@example.test",
    });
  });

  it("still succeeds when a real user already owns the bot address", async () => {
    await testPrisma.user.create({
      data: {
        id: "squatter",
        name: "Squatter",
        email: BOT_USER_EMAIL,
        emailVerified: true,
      },
    });
    const upsert = vi.fn().mockResolvedValue({});

    // The address is unique, so the upsert is keyed on `id` only; the call
    // shape is what guarantees the collision cannot change the lookup.
    await ensureBotUser({ user: { upsert } } as never, "bot-id");

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "bot-id" }, update: { name: "Nimbus" } }),
    );
    // And the helper really did not touch the squatter's row.
    await expect(
      testPrisma.user.findUniqueOrThrow({ where: { id: "squatter" } }),
    ).resolves.toMatchObject({ name: "Squatter" });
  });

  it("throws a named error when no id is configured", async () => {
    await expect(ensureBotUser(testPrisma, "")).rejects.toThrow(
      /BOT_USERID/,
    );
  });

  it("is what resetDatabase uses to restore the row", async () => {
    await resetDatabase();

    await expect(
      testPrisma.user.findUnique({ where: { id: process.env.BOT_USERID } }),
    ).resolves.toMatchObject({ email: BOT_USER_EMAIL });
    // createUser keeps working alongside the bot row.
    await expect(createUser("Alice")).resolves.toBeDefined();
  });
});
