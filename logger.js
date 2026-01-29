const fs = require('fs');
const path = require('path');

function logDebug(message) {
    const logFile = path.join(__dirname, 'server_debug.log');
    const timestamp = new Date().toISOString();
    fs.appendFileSync(logFile, `[${timestamp}] ${message}\n`);
}

module.exports = logDebug;
