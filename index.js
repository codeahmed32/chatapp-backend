import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose"; 
import ConnectDb from "./Utils/ConnectDb.js";
import redisClient, { connectRedis } from "./Utils/redis.js";
import { initCronJobs } from "./Utils/cronJob.js";
import Room from "./models/messages.js"; 



app.get("/", (req, res) => {
    res.status(200).json({
        ok: true,
        message: "Chat App Real-Time Backend Service is Running..."
    });
});


dotenv.config();
const app = express();

const ALLOWED_ORIGIN = process.env.FRONTEND_URL || "https://chat-app-front-end-react-js.vercel.app";

app.use(cors({ 
    origin: (origin, callback) => {
        if (!origin || origin.includes("vercel.app") || origin.includes("localhost")) {
            return callback(null, true);
        }
        return callback(null, true);
    },
    methods: ["GET", "POST"],
    credentials: true
}));
app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: true,
        methods: ["GET", "POST"],
        credentials: true,
    },
    transports: ["polling", "websocket"] 
});

const rooms = {};

// Clean up empty room state
const cleanupRoom = (roomId) => {
    if (rooms[roomId] && rooms[roomId].length === 0) {
        delete rooms[roomId];
    }
};

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
        } catch (err) {
            console.error("Error fetching chat history from MongoDB:", err);
        }
    });

    socket.on("leave", (roomId) => {
        if (!roomId) return;
        const cleanRoomId = String(roomId).trim();
        socket.leave(cleanRoomId);
        if (rooms[cleanRoomId]) {
            rooms[cleanRoomId] = rooms[cleanRoomId].filter(user => user.id !== socket.id);
            io.to(cleanRoomId).emit("room_users", rooms[cleanRoomId]);
            cleanupRoom(cleanRoomId);
        }
    });

    socket.on("send", async (messagePayload) => {
        const { room, senderName, message } = messagePayload;
        
        if (!room || !senderName || !message || String(message).trim() === "") {
            return; 
        }

        const cleanMessage = String(message)
            .trim()
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");

        if (cleanMessage.length > 1000) {
            return socket.emit("error_message", "Message limits exceeded.");
        }

        // Generate valid ObjectId for sync across frontend/backend
        const messageId = new mongoose.Types.ObjectId();

        const dataToStore = {
            _id: messageId,
            roomId: String(room).trim(),
            senderName: String(senderName).substring(0, 50).trim(),
            message: cleanMessage,
            timeStamp: new Date().toISOString()
        };

        // Broadcast to client with generated message ID
        io.to(dataToStore.roomId).emit("message", dataToStore);

        try {
            if (redisClient?.isOpen) {
                await redisClient.lPush("chat_messages", JSON.stringify(dataToStore));
            }
        } catch (err) {
            console.error("Redis Cache Push Failed (Non-blocking):", err.message);
        }
    });

    socket.on("edit_message", async ({ room, messageId, newMessage }) => {
        if (!room || !messageId || !newMessage || String(newMessage).trim() === "") return;

        const cleanMessage = String(newMessage).trim().replace(/</g, "&lt;").replace(/>/g, "&gt;");

        io.to(room).emit("message_edited", { messageId, message: cleanMessage });

        try {
            const targetId = mongoose.Types.ObjectId.isValid(messageId) 
                ? new mongoose.Types.ObjectId(messageId) 
                : messageId;

            await Room.updateOne(
                { roomId: room, "messages._id": targetId },
                { $set: { "messages.$.message": cleanMessage, "messages.$.isEdited": true } }
            );
        } catch (err) {
            console.error("Failed to edit message in DB:", err);
        }
    });

    socket.on("delete_message", async ({ room, messageId }) => {
        if (!room || !messageId) return;

        io.to(room).emit("message_deleted", { messageId });

        try {
            const targetId = mongoose.Types.ObjectId.isValid(messageId) 
                ? new mongoose.Types.ObjectId(messageId) 
                : messageId;

            await Room.updateOne(
                { roomId: room },
                { $pull: { messages: { _id: targetId } } }
            );
        } catch (err) {
            console.error("Failed to delete message from DB:", err);
        }
    });

    socket.on("disconnect", () => {
        const { roomId } = socket;
        if (roomId && rooms[roomId]) {
            rooms[roomId] = rooms[roomId].filter(user => user.id !== socket.id);
            io.to(roomId).emit("room_users", rooms[roomId]);
            cleanupRoom(roomId);
        }
    });
});

const startServer = async () => {
    try {
        await ConnectDb();
        try {
            await connectRedis();
        } catch (redisErr) {
            console.error("Redis connection failed, continuing without volatile cache:", redisErr.message);
        }
        
        initCronJobs();

        const PORT = process.env.PORT || 5050;
        server.listen(PORT, "0.0.0.0", () => {
            console.log(`Chat server running at port ${PORT}`);
        });
    } catch (err) {
        console.error("Fatal startup error:", err);
        process.exit(1);
    }
};

startServer();