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

const ALLOWED_ORIGIN = "https://chat-app-front-end-react-js.vercel.app";

app.use(cors({ 
    origin: ALLOWED_ORIGIN,
    methods: ["GET", "POST"],
    credentials: true
}));
app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: ALLOWED_ORIGIN,
        methods: ["GET", "POST"],
        credentials: true,
    },
    transports: ["websocket", "polling"] 
});

const rooms = {};

io.on("connection", (socket) => {
    console.log(`User Connected: ${socket.id}`);

    socket.on("join", async ({ roomId, userName }) => {
        if (!roomId || !userName) return;

        const cleanRoomId = String(roomId).trim();
        const cleanUserName = String(userName).trim().substring(0, 50);

        socket.join(cleanRoomId);
        socket.roomId = cleanRoomId;
        socket.userName = cleanUserName;

        if (!rooms[cleanRoomId]) {
            rooms[cleanRoomId] = [];
        }

        if (!rooms[cleanRoomId].some(user => user.id === socket.id)) {
            rooms[cleanRoomId].push({
                id: socket.id,
                name: cleanUserName,
                avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(cleanUserName)}`,
                status: "Active Now"
            });
        }

        io.to(cleanRoomId).emit("room_users", rooms[cleanRoomId]);

        try {
            const roomData = await Room.findOne({ roomId: cleanRoomId });
            const history = roomData ? roomData.messages : [];
            socket.emit("chat_history", history); 
            console.log(`Historic logs transmitted for room: ${cleanRoomId}`);
        } catch (err) {
            console.error("Error fetching chat history from MongoDB:", err);
        }
    });

    socket.on("leave", (roomId) => {
        if (!roomId) return;
        socket.leave(roomId);
        if (rooms[roomId]) {
            rooms[roomId] = rooms[roomId].filter(user => user.id !== socket.id);
            io.to(roomId).emit("room_users", rooms[roomId]);
        }
    });

    socket.on("send", async (messagePayload) => {
        const { room, senderName, message } = messagePayload;
        
        if (!room || !senderName || !message || String(message).trim() === "") {
            return; 
        }

        if (message.length > 1000) {
            return socket.emit("error_message", "Message limits exceeded.");
        }

        const listKey = "chat_messages";
        const dataToStore = {
            roomId: String(room),
            senderName: String(senderName).substring(0, 50),
            message: String(message).trim(),
            timeStamp: new Date()
        };

        io.to(room).emit("message", dataToStore);

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