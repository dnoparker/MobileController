// ===== File: server.js =====
// Run with: node server.js

const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, "public")));

// Store connected clients
const clients = new Map();

// Socket.io connection handling
io.on("connection", (socket) => {
  console.log(`New client connected: ${socket.id}`);
  clients.set(socket.id, { connected: true });
  
  // Send controller connected event to Unity
  io.emit("controllerConnected", { clientId: socket.id });
  
  // Process controller input messages
  socket.on("playerInput", (data) => {
    // Log the input data we're receiving from the controller
    console.log(`Input from ${socket.id}:`, data);
    
    // Forward the input to Unity
    // For button input, data will be like: { action: "UP" }
    // For vector input, data will be like: { type: "vector", x: 0.5, y: -0.2 }
    io.emit("inputToUnity", { ...data, clientId: socket.id });
  });
  
  // Process Unity response messages (not used yet)
  socket.on("unityResponse", (data) => {
    console.log(`Response from Unity:`, data);
    // We could send this to specific controllers if needed
  });
  
  // Handle disconnection
  socket.on("disconnect", () => {
    console.log(`Client disconnected: ${socket.id}`);
    if (clients.has(socket.id)) {
      clients.delete(socket.id);
    }
    
    // Send controller disconnected event to Unity
    io.emit("controllerDisconnected", { clientId: socket.id });
  });
});

// Serve the controller page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "controller.html"));
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Controller URL: http://localhost:${PORT}`);
});
