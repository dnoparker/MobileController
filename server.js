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

// Keep track of connected controllers
const connectedControllers = new Set();

io.on("connection", (socket) => {
  console.log("New controller connected:", socket.id);
  
  // Add to connected controllers set
  connectedControllers.add(socket.id);
  
  // Send the client their ID
  socket.emit("clientId", { id: socket.id });
  
  // Broadcast to all that a new controller has connected
  socket.broadcast.emit("controllerConnected", { clientId: socket.id });

  socket.on("controllerInput", (data) => {
    // Forward input to Unity with client ID
    const inputData = {
      ...data,
      clientId: socket.id
    };
    socket.broadcast.emit("inputToUnity", inputData);
    console.log(`Input from ${socket.id}: ${data.action}`);
  });

  socket.on("disconnect", () => {
    console.log("Disconnected:", socket.id);
    
    // Remove from connected controllers set
    connectedControllers.delete(socket.id);
    
    // Broadcast to all that a controller has disconnected
    io.emit("controllerDisconnected", { clientId: socket.id });
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
