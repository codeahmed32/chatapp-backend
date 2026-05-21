import express from "express";
import http from "http";
import { Server } from "socket.io";


const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        method: ["GET", "POST"],
        Credential: true,
    },

});
// on = listen
io.on("connection", (socket) => {
    console.log("User Connected")
    // For Joining
    socket.on("join", (roomId) => {
        socket.join(roomId);
    })
    socket.on("leave", (roomId) => {
        socket.leave(roomId);
    })
    socket.on("send", (message) => {
        socket.to(message.room).emit("message", message);
    });

});

server.listen(5050, () => {
    console.log("server is running at port 5050")
});