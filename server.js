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

// Store connected clients with simplified structure
// Key: socket.id, Value: player info
const clients = new Map();

// Store player sessions with persistent IDs
// Key: playerId, Value: { socketId, lastUsed, playerData }
const playerSessions = new Map();

// Store socket to player mapping for quick lookup
// Key: socket.id, Value: playerId
const socketToPlayer = new Map();

// Auto-incrementing player ID counter (in production, use database IDs)
let nextPlayerId = 1;

// Function to generate a new player ID
function generatePlayerId() {
  return `player_${nextPlayerId++}`;
}

// Function to get or create player ID for a client
function getOrCreatePlayerId(socket, requestedPlayerId = null) {
  // If client requests a specific player ID (reconnection)
  if (requestedPlayerId && playerSessions.has(requestedPlayerId)) {
    const session = playerSessions.get(requestedPlayerId);
    
    // Update the session with new socket
    session.socketId = socket.id;
    session.lastUsed = Date.now();
    
    // Update mappings
    socketToPlayer.set(socket.id, requestedPlayerId);
    
    console.log(`Player ${requestedPlayerId} reconnected with socket ${socket.id}`);
    return requestedPlayerId;
  }
  
  // Create new player ID
  const newPlayerId = generatePlayerId();
  
  // Create new session
  playerSessions.set(newPlayerId, {
    socketId: socket.id,
    lastUsed: Date.now(),
    playerData: {
      // Add any persistent player data here
      joinedAt: Date.now(),
      totalSessions: 1
    }
  });
  
  // Update mappings
  socketToPlayer.set(socket.id, newPlayerId);
  
  console.log(`New player ${newPlayerId} created for socket ${socket.id}`);
  return newPlayerId;
}

// Cleanup settings for player sessions
const SESSION_CLEANUP_INTERVAL = 5 * 60 * 1000; // Check every 5 minutes
const SESSION_EXPIRY_TIME = 10 * 60 * 1000; // Remove after 10 minutes of inactivity

// Cleanup function for old player sessions
function cleanupPlayerSessions() {
  const now = Date.now();
  const toDelete = [];
  
  for (const [playerId, session] of playerSessions.entries()) {
    if (now - session.lastUsed > SESSION_EXPIRY_TIME) {
      toDelete.push(playerId);
    }
  }
  
  if (toDelete.length > 0) {
    console.log(`Cleaning up ${toDelete.length} expired player sessions`);
    toDelete.forEach(id => {
      const session = playerSessions.get(id);
      if (session && socketToPlayer.has(session.socketId)) {
        socketToPlayer.delete(session.socketId);
      }
      playerSessions.delete(id);
    });
  }
}

// Start periodic cleanup
setInterval(cleanupPlayerSessions, SESSION_CLEANUP_INTERVAL);

// Function to log server statistics
function logServerStats() {
  console.log(`Server Stats - Connected clients: ${clients.size}, Persistent mappings: ${playerSessions.size}`);
}

// Log stats every 30 minutes
setInterval(logServerStats, 30 * 60 * 1000);

// Socket.io connection handling
io.on("connection", (socket) => {
  console.log(`New client connected: ${socket.id}`);
  
  // Store basic client info
  clients.set(socket.id, { 
    connected: true,
    playerId: null,
    lastActivity: Date.now()
  });
  
  // Handle player connection/reconnection
  socket.on("requestPlayerId", (data) => {
    console.log(`Player ID request from ${socket.id}:`, data);
    
    // Get or create player ID
    const playerId = getOrCreatePlayerId(socket, data.requestedPlayerId);
    
    // Update client info
    clients.get(socket.id).playerId = playerId;
    clients.get(socket.id).lastActivity = Date.now();
    
    // Send player ID back to client
    socket.emit("playerIdAssigned", {
      playerId: playerId,
      isReconnection: data.requestedPlayerId && playerSessions.has(data.requestedPlayerId)
    });
    
    // Notify Unity about the player
    if (data.requestedPlayerId && playerSessions.has(data.requestedPlayerId)) {
      // This is a reconnection
      io.emit("playerReconnected", { 
        playerId: playerId,
        socketId: socket.id
      });
    } else {
      // This is a new connection
      io.emit("playerConnected", { 
        playerId: playerId,
        socketId: socket.id
      });
    }
  });
  
  // Process controller input messages
  socket.on("playerInput", (data) => {
    const playerId = socketToPlayer.get(socket.id);
    
    if (!playerId) {
      console.warn(`Input from unregistered socket: ${socket.id}`);
      return;
    }
    
    // Update last activity time
    if (clients.has(socket.id)) {
      clients.get(socket.id).lastActivity = Date.now();
    }
    
    if (playerSessions.has(playerId)) {
      playerSessions.get(playerId).lastUsed = Date.now();
    }
    
    // Handle special PING action
    if (data.action === "PING") {
      console.log(`Ping received from player ${playerId}`);
      
      io.emit("playerPing", {
        playerId: playerId,
        socketId: socket.id
      });
      
      return;
    }
    
    // Forward the input to Unity with simplified data
    const inputData = {
      ...data,
      playerId: playerId,
      socketId: socket.id
    };
    
    io.emit("inputToUnity", inputData);
  });
  
  // Handle disconnection
  socket.on("disconnect", () => {
    console.log(`Client disconnected: ${socket.id}`);
    
    const playerId = socketToPlayer.get(socket.id);
    const clientData = clients.get(socket.id);
    
    if (playerId) {
      console.log(`Player ${playerId} disconnected`);
      
      // Update session timestamp but don't remove yet (allow reconnection)
      if (playerSessions.has(playerId)) {
        playerSessions.get(playerId).lastUsed = Date.now();
      }
      
      // Notify Unity about the disconnection
      io.emit("playerDisconnected", { 
        playerId: playerId,
        socketId: socket.id,
        temporary: true // Allow reconnection
      });
      
      // Clean up mappings
      socketToPlayer.delete(socket.id);
    }
    
    // Remove from clients map
    clients.delete(socket.id);
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
    persistentMappings: playerSessions.size,
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
