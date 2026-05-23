import cron from "node-cron";
import redisClient from "./redis.js"; 
import Room from "./model/messages.js"; 

export const initCronJobs = () => {
    cron.schedule("*/5 * * * *", async () => {
        console.log("Running Sync: Redis Temporary Data to MongoDB Room Document...");
        const listKey = "chat_messages";

        try {
            const cachedMessages = await redisClient.lRange(listKey, 0, -1);

            if (cachedMessages.length > 0) {
                await redisClient.del(listKey);

                for (const rawMsg of cachedMessages) {
                    const parsedMsg = JSON.parse(rawMsg);
                    const { roomId, senderName, message, timeStamp } = parsedMsg;

                    await Room.findOneAndUpdate(
                        { roomId: roomId }, 
                        { 
                            $push: { 
                                messages: { senderName, message, timeStamp: timeStamp || new Date() } 
                            } 
                        },
                        { upsert: true } 
                    );
                }
                console.log(`successfully synced ${cachedMessages.length} messages into their respective rooms.`);
            } else {
                console.log("Sync Engine: No new logs found inside Redis instance.");
            }
        } catch (err) {
            console.error("Critical Cron Sync Worker Exception:", err);
        }
    });
};