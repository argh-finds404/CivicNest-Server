const express = require("express");
require("dotenv").config();
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const app = express();

const allowedOrigins = [
  "http://localhost:5173",
  process.env.CLIENT_BASE_URL,
  process.env.CLIENT_URL
].filter(Boolean);

const corsOriginOption = function (origin, callback) {
  if (!origin) return callback(null, true);
  if (allowedOrigins.indexOf(origin) !== -1) {
    return callback(null, true);
  }
  const isWhitelisted = 
    origin.includes("localhost") || 
    origin.endsWith(".firebaseapp.com") || 
    origin.endsWith(".web.app") || 
    origin.endsWith(".vercel.app") || 
    origin.endsWith(".netlify.app");
    
  if (isWhitelisted) {
    return callback(null, true);
  }
  callback(new Error(`Origin ${origin} not allowed by CORS`));
};

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: corsOriginOption,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
    credentials: true
  }
});
app.set("io", io);

const activeRooms = {}; // { threadId: { socketId: { email, name, photo } } }

io.on("connection", (socket) => {
  const handleLeave = (threadId) => {
    if (activeRooms[threadId] && activeRooms[threadId][socket.id]) {
      delete activeRooms[threadId][socket.id];
      if (Object.keys(activeRooms[threadId]).length === 0) {
        delete activeRooms[threadId];
      } else {
        const onlineUsers = Object.values(activeRooms[threadId]);
        io.to(`thread:${threadId}`).emit("room_users", onlineUsers);
      }
    }
  };

  socket.on("join_thread", (data) => {
    const payload = typeof data === 'object' ? data : { threadId: data };
    const { threadId, userEmail, userName, userPhoto } = payload;
    
    socket.join(`thread:${threadId}`);
    
    if (userEmail) {
      if (!activeRooms[threadId]) activeRooms[threadId] = {};
      activeRooms[threadId][socket.id] = { 
        email: userEmail, 
        name: userName || userEmail, 
        photo: userPhoto || null 
      };
      
      const onlineUsers = Object.values(activeRooms[threadId]);
      io.to(`thread:${threadId}`).emit("room_users", onlineUsers);
    }
  });

  socket.on("leave_thread", (data) => {
    const threadId = typeof data === 'object' ? data.threadId : data;
    socket.leave(`thread:${threadId}`);
    handleLeave(threadId);
  });

  socket.on("typing", ({ threadId, userEmail, userName, isTyping }) => {
    socket.to(`thread:${threadId}`).emit("user_typing", { userEmail, userName, isTyping });
  });

  socket.on("disconnect", () => {
    for (const threadId in activeRooms) {
      handleLeave(threadId);
    }
  });
});

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const port = process.env.PORT||3000;

app.use(cors({
  origin: corsOriginOption,
  credentials: true
}));

// stripe webhook needs raw body, must load before json parser
const paymentRoutes = require("./routes/payment");
app.post("/api/payment/stripe-webhook", express.raw({ type: 'application/json' }), paymentRoutes.stripeWebhookHandler);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const path = require("path");
const fs = require("fs");
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.post("/upload", async (req, res) => {
  try {
    const { name, base64 } = req.body;
    if (!name || !base64) {
      return res.status(400).json({ error: "Missing name or base64 data" });
    }
    const uploadsDir = path.join(__dirname, "uploads");
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    const uniqueName = `${Date.now()}-${name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
    const filePath = path.join(uploadsDir, uniqueName);
    const buffer = Buffer.from(base64, "base64");
    fs.writeFileSync(filePath, buffer);
    const fileUrl = `${req.protocol}://${req.get("host")}/uploads/${uniqueName}`;
    res.json({ success: true, url: fileUrl });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ error: "Failed to upload file" });
  }
});

const { verifyToken } = require("./middleware/auth");

const { connectDB } = require("./config/db");

const usersRoutes = require("./routes/users");
const issuesRoutes = require("./routes/issues");
const contributionsRoutes = require("./routes/contributions");
const lostFoundRoutes = require("./routes/lostFound");
const animalsRoutes = require("./routes/animals");
const membershipRoutes = require("./routes/membership");
const adminRoutes = require("./routes/admin");
const announcementsRoutes = require("./routes/announcements");
const volunteersRoutes = require("./routes/volunteers");
const forumRoutes = require("./routes/forum");
const notificationsRoutes = require("./routes/notifications");
const creditsRoutes = require("./routes/credits");
const aiRoutes = require("./routes/ai");
const feedingDrivesRoutes = require("./routes/feedingDrives");
const leaderboardRoutes = require("./routes/leaderboard");
const commentsRoutes = require("./routes/comments");
const singleCommentRoutes = require("./routes/singleComment");
const ngosRoutes = require("./routes/ngos");
const pollsRoutes = require("./routes/polls");
const publicRoutes = require("./routes/public");
const cleanupEventsRoutes = require("./routes/cleanupEvents");
const galleryRoutes = require("./routes/gallery");

app.get("/", (req, res) => {
  res.send("Hello World! CivicNest API is running.");
});

app.use("/public", publicRoutes);
app.use("/users", usersRoutes);
app.use("/issues", issuesRoutes);
app.use("/contributions", contributionsRoutes);
app.use("/lost-found", lostFoundRoutes);
app.use("/animals", animalsRoutes);
app.use("/membership", membershipRoutes);
app.use("/admin", adminRoutes);
app.use("/announcements", announcementsRoutes);
app.use("/volunteers", volunteersRoutes);
app.use("/forum", forumRoutes);
app.use("/notifications", notificationsRoutes);
app.use("/credits", creditsRoutes);
app.use("/ai", aiRoutes);
app.use("/feeding-drives", feedingDrivesRoutes);
app.use("/leaderboard", leaderboardRoutes);
app.use("/ngos", ngosRoutes);
app.use("/polls", pollsRoutes);
app.use("/cleanup-events", cleanupEventsRoutes);
app.use("/api/payment", paymentRoutes);
app.use("/gallery", galleryRoutes);

app.use("/issues/:id/comments", commentsRoutes);
app.use("/comments", singleCommentRoutes);

async function startServer() {
  try {
    const db = await connectDB();
    app.locals.db = db;
    server.listen(port, () => {
      console.log(`CivicNest Server running on port ${port}`);
    });
  } catch (err) {
    console.error("Failed to start server", err);
    process.exit(1);
  }
}

startServer();
