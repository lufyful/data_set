const express = require("express");
const cors = require("cors"); 
require("./controllers/cronScraper.cjs");
const app = express();

app.use(cors());
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", message: "Server is healthy ✅" });
});

app.get("/", (req, res) => {
  res.send("Welcome to the API");
});

app.use((req, res, next) => {
  res.status(404).json({ error: "Route not found" });
});

app.use((err, req, res, next) => {
  console.error(err.stack || err);
  res.status(500).json({ error: "Internal server error" });
});
module.exports = app;
