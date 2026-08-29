const app = require("../server.js");

module.exports = (req, res) => {
  return app(req, res);
};
