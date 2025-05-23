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

// Store persistent player mapping with timestamps for cleanup
// Structure: { persistentId: { socketId: string, lastUsed: timestamp } }
const persistentPlayers = new Map();

// Cleanup settings for persistent players
const PERSISTENT_CLEANUP_INTERVAL = 5 * 60 * 1000; // Check every 5 minutes
const PERSISTENT_EXPIRY_TIME = 10 * 60 * 1000; // Remove after 10 minutes of inactivity

// Cleanup function for old persistent player mappings
function cleanupPersistentPlayers() {
  const now = Date.now();
  const toDelete = [];
  
  for (const [persistentId, data] of persistentPlayers.entries()) {
    if (now - data.lastUsed > PERSISTENT_EXPIRY_TIME) {
      toDelete.push(persistentId);
    }
  }
  
  if (toDelete.length > 0) {
    console.log(`Cleaning up ${toDelete.length} expired persistent player mappings`);
    toDelete.forEach(id => persistentPlayers.delete(id));
  }
}

// Start periodic cleanup
setInterval(cleanupPersistentPlayers, PERSISTENT_CLEANUP_INTERVAL);

// Function to log server statistics
function logServerStats() {
  console.log(`Server Stats - Connected clients: ${clients.size}, Persistent mappings: ${persistentPlayers.size}`);
}

// Log stats every 30 minutes
setInterval(logServerStats, 30 * 60 * 1000);

// Socket.io connection handling
io.on("connection", (socket) => {
  console.log(`New client connected: ${socket.id}`);
  
  // Store basic client info first
  clients.set(socket.id, { 
    connected: true,
    persistentId: null,
    reconnected: false,
    lastActivity: Date.now() // Track last activity time
  });
  
  // Handle player reconnection with persistent ID
  socket.on("playerReconnect", (data) => {
    console.log(`Reconnection attempt from ${socket.id} with previous ID: ${data.previousId}`);
    
    // Update last activity time
    if (clients.has(socket.id)) {
      clients.get(socket.id).lastActivity = Date.now();
    }
    
    // Store the persistent ID with this socket
    clients.get(socket.id).persistentId = data.previousId;
    
    // Update the persistent player mapping with timestamp
    persistentPlayers.set(data.previousId, {
      socketId: socket.id,
      lastUsed: Date.now()
    });
    
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
    // Update last activity time for this client
    if (clients.has(socket.id)) {
      clients.get(socket.id).lastActivity = Date.now();
    }
    
    // Log the input data we're receiving from the controller
    console.log(`Input from ${socket.id}:`, data);
    
    // Handle special PING action (used to reset inactivity timer)
    if (data.action === "PING") {
      console.log(`Ping received from ${socket.id}`);
      
      // Forward ping to Unity to reset inactivity timer there as well
      io.emit("playerPing", {
        clientId: socket.id,
        persistentId: data.persistentId || clients.get(socket.id)?.persistentId
      });
      
      // Update persistent player mapping timestamp if we have one
      const persistentId = data.persistentId || clients.get(socket.id)?.persistentId;
      if (persistentId && persistentPlayers.has(persistentId)) {
        persistentPlayers.get(persistentId).lastUsed = Date.now();
      }
      
      // Don't process further as it's not a movement command
      return;
    }
    
    // Store the persistent ID with this socket if provided
    if (data.persistentId && clients.has(socket.id)) {
      clients.get(socket.id).persistentId = data.persistentId;
      persistentPlayers.set(data.persistentId, {
        socketId: socket.id,
        lastUsed: Date.now()
      });
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
      // Log the persistent ID if we have one
      if (clientData.persistentId) {
        console.log(`Player with persistent ID ${clientData.persistentId} disconnected`);
        
        // Update the last used timestamp for the persistent mapping
        // but don't remove it yet - allow for reconnection
        if (persistentPlayers.has(clientData.persistentId)) {
          persistentPlayers.get(clientData.persistentId).lastUsed = Date.now();
        }
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

// Health check endpoint with server stats
app.get("/health", (req, res) => {
  const stats = {
    status: "healthy",
    timestamp: new Date().toISOString(),
    connectedClients: clients.size,
    persistentMappings: persistentPlayers.size,
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage()
  };
  res.json(stats);
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Controller URL: http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});
