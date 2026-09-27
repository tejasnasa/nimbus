/**
 * @module api/__tests__/integration/persistence/aiCascade
 * @description The ON DELETE CASCADE rules for the new AI tables.
 *
 * `AiCredential` and `AiFeaturePreference` both reference `user.id` with
 * `onDelete: Cascade`, so a deleted account leaves no orphaned rows. The
 * trade-off stated in the plan is that nothing of consequence is lost, since
 * the credentials must die with the account anyway — so this is the property
 * that matters, and the suite asserts it through the database rather than
 * through the schema text.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  closeTestResources,
  resetDatabase,
  testPrisma,
} from "@testhelpers";

let userId: string;

beforeAll(async () => {
  await resetDatabase();
});

beforeEach(async () => {
  await resetDatabase();
  const user = await testPrisma.user.create({
    data: {
      id: "ai-cascade-user",
      name: "Cascade User",
      email: "cascade@example.com",
    },
  });
  userId = user.id;
});

afterAll(async () => {
  await closeTestResources();
});

describe("deleting a user", () => {
  it("removes their AI credentials and preferences", async () => {
    await testPrisma.aiCredential.create({
      data: {
        userId,
        providerId: "openai",
        keyEnvelope: "nimbus1.deadbeef.AAAA.BBBB.CCCC",
        keyId: "deadbeef",
        keyFingerprint: "cafef00dcafef00d",
        maskedPreview: "sk-…4f2a",
      },
    });
    await testPrisma.aiCredential.create({
      data: {
        userId,
        providerId: "groq",
        keyEnvelope: "nimbus1.deadbeef.AAAA.BBBB.CDDD",
        keyId: "deadbeef",
        keyFingerprint: "0123456789abcdef",
        maskedPreview: "gsk-…abcd",
      },
    });
    await testPrisma.aiFeaturePreference.create({
      data: {
        userId,
        feature: "CHAT",
        providerId: "openai",
        modelId: "gpt-5-nano",
      },
    });
    await testPrisma.aiFeaturePreference.create({
      data: {
        userId,
        feature: "CANVAS",
        providerId: "deepseek",
        modelId: "deepseek-flash",
      },
    });

    await testPrisma.user.delete({ where: { id: userId } });

    expect(await testPrisma.aiCredential.count({ where: { userId } })).toBe(0);
    expect(await testPrisma.aiFeaturePreference.count({ where: { userId } })).toBe(0);
  });

  it("leaves credentials of other users untouched", async () => {
    const other = await testPrisma.user.create({
      data: {
        id: "other-user",
        name: "Other",
        email: "other@example.com",
      },
    });
    await testPrisma.aiCredential.create({
      data: {
        userId,
        providerId: "openai",
        keyEnvelope: "nimbus1.deadbeef.AAAA.BBBB.CCCC",
        keyId: "deadbeef",
        keyFingerprint: "cafef00dcafef00d",
        maskedPreview: "sk-…4f2a",
      },
    });
    await testPrisma.aiCredential.create({
      data: {
        userId: other.id,
        providerId: "groq",
        keyEnvelope: "nimbus1.deadbeef.DDDD.EEEE.FFFF",
        keyId: "deadbeef",
        keyFingerprint: "fedcba9876543210",
        maskedPreview: "gsk-…abcd",
      },
    });

    await testPrisma.user.delete({ where: { id: userId } });

    expect(await testPrisma.aiCredential.count({ where: { userId } })).toBe(0);
    // The other user's row is untouched.
    expect(
      await testPrisma.aiCredential.count({ where: { userId: other.id } }),
    ).toBe(1);
  });

  it("enforces the (user, provider) unique constraint", async () => {
    await testPrisma.aiCredential.create({
      data: {
        userId,
        providerId: "openai",
        keyEnvelope: "nimbus1.deadbeef.AAAA.BBBB.CCCC",
        keyId: "deadbeef",
        keyFingerprint: "cafef00dcafef00d",
        maskedPreview: "sk-…4f2a",
      },
    });

    await expect(
      testPrisma.aiCredential.create({
        data: {
          userId,
          providerId: "openai",
          keyEnvelope: "nimbus1.deadbeef.EEEE.FFFF.AAAA",
          keyId: "deadbeef",
          keyFingerprint: "0011223344556677",
          maskedPreview: "sk-…9988",
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("enforces the (user, feature) unique constraint", async () => {
    await testPrisma.aiFeaturePreference.create({
      data: {
        userId,
        feature: "CHAT",
        providerId: "openai",
        modelId: "gpt-5-nano",
      },
    });

    await expect(
      testPrisma.aiFeaturePreference.create({
        data: {
          userId,
          feature: "CHAT",
          providerId: "deepseek",
          modelId: "deepseek-flash",
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});
