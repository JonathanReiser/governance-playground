/**
 * Vercel Serverless Function Endpoint for /api/agent/decide
 */
const server = require("../../server.js");

module.exports = async function handler(req, res) {
  // Delegate to express server app
  return server(req, res);
};
