/**
 * @module api/controllers/turn
 * @description WebRTC ICE configuration endpoint: pairs public STUN servers
 * with time-limited TURN allocation credentials. Requires TURN_SERVER_URL.
 */
import { ServerResponse } from "@nimbus/types";
import { generateTurnCredentials } from "../lib/turnCredentials";

/**
 * Builds the client's `iceServers` config (STUN + TURN/UDP + TURN/TCP).
 *
 * @param userId - Authenticated user's ID, embedded in the TURN username.
 * @returns ICE server list or a 500 when TURN_SERVER_URL is unconfigured.
 */
export const getTurnCredentials = async (userId: string) => {
  try {
    const credentials = generateTurnCredentials(userId);

    const turnUrl = process.env.TURN_SERVER_URL;

    if (!turnUrl) {
      console.error("Missing TURN_SERVER_URL env variable.");
      return ServerResponse.internalError(
        null,
        "TURN server configuration is missing",
      );
    }

    const responseData = {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        {
          urls: [`${turnUrl}?transport=udp`, `${turnUrl}?transport=tcp`],
          username: credentials.username,
          credential: credentials.credential,
        },
      ],
    };

    return ServerResponse.ok(responseData);
  } catch (error) {
    console.error("Error generating TURN credentials:", error);
    return ServerResponse.internalError(error);
  }
};
