require("dotenv").config();

const express = require("express");
const cors = require("cors");

const connectDB = require("./config/db");
const dashboardRoutes = require("./routes/dashboardRoutes");



app.use(express.json());
app.use(
  cors({
    origin: "https://task-management.cnxhub.in/",
    credentials: true,
  }),
);

const app = express();

connectDB();

app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/tasks", require("./routes/taskRoutes"));
app.use("/api/dashboard", dashboardRoutes);

app.use("/api/users", require("./routes/userRoutes"));
app.use("/api/profile", require("./routes/profileRoutes"));

app.use("/api/employees", require("./routes/employeeRoutes"));

app.listen(process.env.PORT, () => {
  console.log(`Server Running ${process.env.PORT}`);
});
