// Vercel serverless entry point — just hands off to the real Express app.
// See ../server.js for the actual routes/logic; this file exists only
// because Vercel's Node runtime looks for handlers under /api.
module.exports = require("../server.js");
