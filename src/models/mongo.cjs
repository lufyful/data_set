// db.js
require("dotenv").config();
const mongoose = require("mongoose");

const opt = {
  authSource: "admin",
  connectTimeoutMS: 10000,
  socketTimeoutMS: 3000000,
};

async function connectDB() {
  const uri = process.env.MONGO_URL;
  if (!uri) throw new Error('MONGO_URL is not set');

  await mongoose.connect(uri, opt);
  console.log('✅ MongoDB connected');
}

mongoose.connection.on('connected', () => {
  console.log('Mongoose connected to DB');
});

mongoose.connection.on('error', (err) => {
  console.error('Mongoose connection error:', err);
});

mongoose.connection.on('disconnected', () => {
  console.warn('Mongoose disconnected');
});

process.on('SIGINT', async () => {
  await mongoose.connection.close(false);
  console.log('MongoDB connection closed on app termination');
  process.exit(0);
});

module.exports = { mongoose, connectDB };
