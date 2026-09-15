// Shared byte-compatible SHA-256 primitive; existing preregistration hashes stay unchanged.
const crypto = require("node:crypto");
function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}
module.exports = { sha256 };
