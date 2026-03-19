import Redis from "ioredis";

export const pubClient = new Redis(process.env.REDIS_URL!);
export const subClient = pubClient.duplicate();

pubClient.on("error", (err) => console.error("Redis pubClient error:", err));
subClient.on("error", (err) => console.error("Redis subClient error:", err));
