import express from "express";
import http from "http";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true,
    },
});

// Room wise users track karne ke liye in-memory object
const rooms = {};

io.on("connection", (socket) => {
    console.log(`User Connected: ${socket.id}`);

    // User data ke sath join event handler
    socket.on("join", ({ roomId, userName }) => {
        socket.join(roomId);
        
        // Save socket parameters globally for disconnect tracking
        socket.roomId = roomId;
        socket.userName = userName;

        if (!rooms[roomId]) {
            rooms[roomId] = [];
        }

        // duplicate entry prevention
        if (!rooms[roomId].some(user => user.id === socket.id)) {
            rooms[roomId].push({
                id: socket.id,
                name: userName,
                avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${userName}`, // Auto-generated consistent avatar
                status: "Active Now"
            });
        }

        // Broadcast updated user list to everyone in the room
        io.to(roomId).emit("room_users", rooms[roomId]);
    });

    socket.on("leave", (roomId) => {
        socket.leave(roomId);
        if (rooms[roomId]) {
            rooms[roomId] = rooms[roomId].filter(user => user.id !== socket.id);
            io.to(roomId).emit("room_users", rooms[roomId]);
        }
    });

    socket.on("send", (message) => {
        // message object strict schema format: { room, sender, text, timestamp }
        socket.to(message.room).emit("message", message);
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

server.listen(5050, () => {
    console.log("Server running at port 5050");
});