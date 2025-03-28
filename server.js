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

// Store connected clients with more detailed information
const clients = new Map();

// Store persistent player mapping (persistentId -> socketId)
const persistentPlayers = new Map();

// Socket.io connection handling
io.on("connection", (socket) => {
  console.log(`New client connected: ${socket.id}`);
  
  // Store basic client info first
  clients.set(socket.id, { 
    connected: true,
    persistentId: null,
    reconnected: false
  });
  
  // Handle player reconnection with persistent ID
  socket.on("playerReconnect", (data) => {
    console.log(`Reconnection attempt from ${socket.id} with previous ID: ${data.previousId}`);
    
    // Store the persistent ID with this socket
    clients.get(socket.id).persistentId = data.previousId;
    
    // Update the persistent player mapping
    persistentPlayers.set(data.previousId, socket.id);
    
    // Notify Unity about the reconnection
    io.emit("playerReconnect", { 
      previousId: data.previousId, 
      currentId: socket.id,
      persistentId: data.previousId
    });
    
    // Tell the client the reconnection was successful
    socket.emit("reconnectionStatus", {
      success: true,
      playerId: data.previousId
    });
    
    // Mark as reconnected
    clients.get(socket.id).reconnected = true;
    
    console.log(`Player ${data.previousId} reconnected with new socket ID: ${socket.id}`);
  });
  
  // Send controller connected event to Unity
  io.emit("controllerConnected", { 
    clientId: socket.id 
  });
  
  // Process controller input messages
  socket.on("playerInput", (data) => {
    // Log the input data we're receiving from the controller
    console.log(`Input from ${socket.id}:`, data);
    
    // Store the persistent ID with this socket if provided
    if (data.persistentId && clients.has(socket.id)) {
      clients.get(socket.id).persistentId = data.persistentId;
      persistentPlayers.set(data.persistentId, socket.id);
    }
    
    // Forward the input to Unity with client ID and persistent ID
    const inputData = {
      ...data,
      clientId: socket.id,
      // If we have a persistent ID, include it
      persistentId: data.persistentId || clients.get(socket.id)?.persistentId
    };
    
    io.emit("inputToUnity", inputData);
  });
  
  // Process Unity response messages (not used yet)
  socket.on("unityResponse", (data) => {
    console.log(`Response from Unity:`, data);
    // We could send this to specific controllers if needed
  });
  
  // Handle disconnection
  socket.on("disconnect", () => {
    console.log(`Client disconnected: ${socket.id}`);
    
    // Get client data
    const clientData = clients.get(socket.id);
    if (clientData) {
      // Don't remove from persistentPlayers map so we can reconnect later
      
      // Log the persistent ID if we have one
      if (clientData.persistentId) {
        console.log(`Player with persistent ID ${clientData.persistentId} disconnected`);
      }
      
      // Remove from clients map
      clients.delete(socket.id);
    }
    
    // Send controller disconnected event to Unity
    // Include persistent ID if available so Unity can handle it appropriately
    io.emit("controllerDisconnected", { 
      clientId: socket.id,
      persistentId: clientData?.persistentId,
      temporary: clientData?.persistentId ? true : false // Mark as temporary if we have a persistent ID
    });
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
