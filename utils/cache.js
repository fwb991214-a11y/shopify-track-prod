const NodeCache = require("node-cache");

// Standard TTL: 1 hour (3600 seconds)
// Check period: 2 minutes (120 seconds)
const cache = new NodeCache({ stdTTL: 3600, checkperiod: 120 });

module.exports = cache;
