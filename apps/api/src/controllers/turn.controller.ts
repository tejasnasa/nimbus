import { ServerResponse } from "@nimbus/types";
import { generateTurnCredentials } from "../lib/turnCredentials";

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
