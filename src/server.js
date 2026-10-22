require("dotenv").config();

const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const mongoose = require("mongoose");
const connectDB = require("./config/db");
const { ensureSystemRoles } = require("./utils/rbac");
const dashboardRoutes = require("./routes/dashboardRoutes");

const app = express();

app.use(express.json());
app.use(express.json({ limit: "10mb" }));
app.use(
  cors({
    origin: "https://task.cnxhub.in",
    credentials: true,
  }),
);

// app.use(cors());

connectDB();
mongoose.connection.once("open", () => {
  ensureSystemRoles().catch((e) => console.log("Role seed failed", e.message));
});

app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/tasks", require("./routes/taskRoutes"));
app.use("/api/dashboard", dashboardRoutes);

app.use("/api/users", require("./routes/userRoutes"));
app.use("/api/user-management", require("./routes/userManagementRoutes"));
app.use("/api/crm", require("./routes/crmRoutes"));
app.use("/api/roles", require("./routes/roleRoutes"));
app.use("/api/profile", require("./routes/profileRoutes"));

app.use("/api/employees", require("./routes/employeeRoutes"));
app.use("/api/clients", require("./routes/clientRoutes"));
app.use("/api/campaigns", require("./routes/campaignRoutes"));
app.use("/api/leads", require("./routes/leadRoutes"));
app.use("/api/projects", require("./routes/projectRoutes"));
app.use("/api/pm", require("./routes/pmRoutes"));
app.use("/api/reports", require("./routes/reportRoutes"));
app.use("/api/finance", require("./routes/financeRoutes"));
app.use("/api/analytics", require("./routes/analyticsRoutes"));
app.use("/api/my-work", require("./routes/myWorkRoutes"));

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  socket.on("disconnect", () => {
    console.log("Socket disconnected:", socket.id);
  });
});

// expose io to controllers via app
app.set("io", io);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server Running ${PORT}`);
});
