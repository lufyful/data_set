global.File = class { };
require('dotenv').config();
const app = require("./app.cjs");
const PORT = process.env.PORT || 3000;
const { connectDB } = require('./models/mongo.cjs');

connectDB()
  .then(() => {
    app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
  })
  .catch((err) => {
    console.error('Failed to connect to MongoDB:', err);
    process.exit(1);
  });

app.listen(PORT, "0.0.0.0", (async) => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
