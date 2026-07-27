const client = require("prom-client");

// Define Prometheus counters
const sessionAutoUpgradesCounter = new client.Counter({
  name: "session_auto_upgrades_total",
  help: "Total number of session CSRF auto-upgrades and synchronizations",
});

const csrfRefreshesCounter = new client.Counter({
  name: "csrf_refreshes_total",
  help: "Total number of CSRF refresh endpoint requests",
});

module.exports = {
  sessionAutoUpgradesCounter,
  csrfRefreshesCounter,
};
