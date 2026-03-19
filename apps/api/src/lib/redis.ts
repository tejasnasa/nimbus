import Redis from "ioredis";

const redisConfig = {
  tls: {
    rejectUnauthorized: false,
  },
  maxRetriesPerRequest: null,
};

export const pubClient = new Redis(process.env.REDIS_URL!, redisConfig);
export const subClient = pubClient.duplicate();

pubClient.on("error", (err) => console.error("Redis pubClient error:", err));
subClient.on("error", (err) => console.error("Redis subClient error:", err));
