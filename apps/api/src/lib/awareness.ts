/**
 * @module api/lib/awareness
 * @description Wire-level helpers for the y-protocols awareness updates the
 * document handlers relay: decoding a client's update, rewriting it so the
 * identity inside is the authenticated one, and re-encoding it.
 *
 * The server does not trust an update's contents. An awareness state is
 * arbitrary JSON authored by the client, so each entry is rebuilt from an
 * allow-list (`user` and `cursor`) with the name, id, colour and avatar taken
 * from the session, and anything malformed rejects the whole update.
 *
 * @important The binary layout mirrors `y-protocols/awareness`
 *            (`encodeAwarenessUpdate` / `applyAwarenessUpdate`): a varuint entry
 *            count, then per entry a varuint client id, a varuint clock and a
 *            varstring of JSON (`"null"` for a removal). If that package ever
 *            changes its framing these helpers must change with it; the socket
 *            tests round-trip real encoder output to catch that.
 */
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { presenceColor } from "@nimbus/utils";

/** Largest awareness update a socket may send, in bytes. */
export const MAX_AWARENESS_BYTES = 64 * 1024;

/** Most client ids one update may carry; a browser tab normally has one. */
export const MAX_AWARENESS_ENTRIES = 8;

/** One client's slot in an awareness update. `state` is `null` for a removal. */
export type AwarenessEntry = {
  clientId: number;
  clock: number;
  state: Record<string, unknown> | null;
};

/** The authenticated user fields the server writes into every state. */
export type SessionIdentity = {
  id: string;
  name: string;
  image?: string | null;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Decodes an awareness update.
 *
 * @param update - Raw bytes as sent by `encodeAwarenessUpdate`.
 * @returns The entries, or `null` when the bytes are malformed, carry trailing
 *          data, hold more than {@link MAX_AWARENESS_ENTRIES} entries, or hold a
 *          state that is neither `null` nor an object.
 */
export const decodeAwarenessEntries = (
  update: Uint8Array,
): AwarenessEntry[] | null => {
  try {
    const decoder = decoding.createDecoder(update);
    const count = decoding.readVarUint(decoder);
    if (count > MAX_AWARENESS_ENTRIES) return null;

    const entries: AwarenessEntry[] = [];
    for (let i = 0; i < count; i++) {
      const clientId = decoding.readVarUint(decoder);
      const clock = decoding.readVarUint(decoder);
      const state: unknown = JSON.parse(decoding.readVarString(decoder));
      if (state !== null && !isPlainObject(state)) return null;
      entries.push({ clientId, clock, state });
    }

    return decoding.hasContent(decoder) ? null : entries;
  } catch {
    return null;
  }
};

/**
 * Encodes entries in the framing `applyAwarenessUpdate` reads.
 *
 * @param entries - Entries to encode.
 */
export const encodeAwarenessEntries = (
  entries: readonly AwarenessEntry[],
): Uint8Array => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, entries.length);
  for (const { clientId, clock, state } of entries) {
    encoding.writeVarUint(encoder, clientId);
    encoding.writeVarUint(encoder, clock);
    encoding.writeVarString(encoder, JSON.stringify(state));
  }
  return encoding.toUint8Array(encoder);
};

/** A y-prosemirror cursor: relative positions for the anchor and the head. */
const isCursor = (value: unknown): boolean =>
  isPlainObject(value) &&
  isPlainObject(value.anchor) &&
  isPlainObject(value.head);

/**
 * Rebuilds a client-authored state so only trusted fields survive.
 *
 * @param state - The state as decoded from the client.
 * @param identity - The authenticated user to stamp into it.
 * @returns A state holding the server-stamped `user` and, when the client sent
 *          a well-formed one, its `cursor` (`null` meaning "no cursor").
 */
export const sanitizeAwarenessState = (
  state: Record<string, unknown>,
  identity: SessionIdentity,
): Record<string, unknown> => {
  const clean: Record<string, unknown> = {
    user: {
      userId: identity.id,
      name: identity.name,
      color: presenceColor(identity.id),
      image: identity.image ?? null,
    },
  };
  if (state.cursor === null || isCursor(state.cursor)) {
    clean.cursor = state.cursor;
  }
  return clean;
};
