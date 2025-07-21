import dotenv from 'dotenv';
import Redis from "ioredis";

// Load environment variables from .env file
dotenv.config();

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

async function testRedis() {
  try {
    const pong = await redis.ping();
    console.log("Redis ping response:", pong);
    console.log("Redis connection successful!");
    console.log("Connected to:", process.env.REDIS_URL);
  } catch (error) {
    console.error("Redis connection failed:", error);
  } finally {
    await redis.quit();
  }
}

testRedis(); 