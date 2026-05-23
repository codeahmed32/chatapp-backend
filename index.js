import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import ConnectDb from "./Utils/ConnectDb.js";
import redisClient, { connectRedis } from "./Utils/redis.js";
import { initCronJobs } from "./Utils/cronJob.js";
import Room from "./models/messages.js"; 
dotenv.config();
const app = express();

app.use(cors({ origin: "*" }));
app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true,
    },
});

const rooms = {};

io.on("connection", (socket) => {
    console.log(`User Connected: ${socket.id}`);

    socket.on("join", async ({ roomId, userName }) => {
        socket.join(roomId);
        socket.roomId = roomId;
        socket.userName = userName;

        if (!rooms[roomId]) {
            rooms[roomId] = [];
        }

        if (!rooms[roomId].some(user => user.id === socket.id)) {
            rooms[roomId].push({
                id: socket.id,
                name: userName,
                avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${userName}`,
                status: "Active Now"
            });
        }

        io.to(roomId).emit("room_users", rooms[roomId]);

        try {
            const roomData = await Room.findOne({ roomId });
            const history = roomData ? roomData.messages : [];
            socket.emit("chat_history", history); 
            console.log(`Historic logs transmitted for room: ${roomId}`);
        } catch (err) {
            console.error("Error fetching chat history from MongoDB:", err);
        }
    });

    socket.on("leave", (roomId) => {
        socket.leave(roomId);
        if (rooms[roomId]) {
            rooms[roomId] = rooms[roomId].filter(user => user.id !== socket.id);
            io.to(roomId).emit("room_users", rooms[roomId]);
        }
    });

    socket.on("send", async (messagePayload) => {
        const { room, senderName, message } = messagePayload;
        const listKey = "chat_messages";

        const dataToStore = {
            roomId: room,
            senderName: senderName,
            message: message,
            timeStamp: new Date()
        };

        socket.to(room).emit("message", dataToStore);

        try {
            await redisClient.lPush(listKey, JSON.stringify(dataToStore));
            await redisClient.expire(listKey, 5400); 
            console.log("Volatile message cache write success.");
        } catch (err) {
            console.error("Failed to push message to Redis:", err);
        }
    });

    socket.on("disconnect", () => {
        console.log(`User Disconnected: ${socket.id}`);
        const { roomId } = socket;
        if (roomId && rooms[roomId]) {
            rooms[roomId] = rooms[roomId].filter(user => user.id !== socket.id);
            io.to(roomId).emit("room_users", rooms[roomId]);
        }
    });
});

const startServer = async () => {
    try {
        await ConnectDb();

        await connectRedis();

        initCronJobs();

        const PORT = process.env.PORT || 5050;
        server.listen(PORT, "0.0.0.0", () => {
            console.log(`Chat server seamlessly running at port ${PORT}`);
        });
    } catch (err) {
        console.error("Fatal startup error, connection aborted:", err);
        process.exit(1);
    }
};

startServer();