// ===== File: server.js =====
// Run with: node server.js

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static("public"));

io.on("connection", (socket) => {
  console.log("New controller connected:", socket.id);

  socket.on("controllerInput", (data) => {
    // Forward input to Unity
    socket.broadcast.emit("inputToUnity", data);
  });

  socket.on("disconnect", () => {
    console.log("Disconnected:", socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
