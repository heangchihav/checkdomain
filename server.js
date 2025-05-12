const express = require('express');
const cors = require('cors');
const os = require('os');
const dns = require('dns');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Get IP address from interface name (e.g., eth1 → 192.168.x.x)
function getInterfaceIP(interfaceName) {
  const interfaces = os.networkInterfaces();
  const iface = interfaces[interfaceName];
  if (!iface) return null;

  for (const detail of iface) {
    if (detail.family === 'IPv4' && !detail.internal) {
      return detail.address;
    }
  }

  return null;
}

// Check domain over HTTPS first, fallback to HTTP
function checkDomain(domain, localAddress) {
  return new Promise((resolve) => {
    dns.lookup(domain, (err) => {
      if (err) {
        // Simplified message - any DNS error is considered blocked
        return resolve({ status: '🔴 BLOCKED' });
      }

      // Use axios to handle redirects automatically
      const options = {
        method: 'GET',
        url: `https://${domain}`,
        timeout: 5000,
        localAddress
      };

      axios(options)
        .then((response) => {
          // Simplified success message
          resolve({ status: `🟢 ACCESSIBLE` });
        })
        .catch((error) => {
          if (error.response && error.response.status) {
            // If we get any HTTP response, try HTTP instead
            axios({ ...options, url: `http://${domain}` })
              .then((response) => {
                // Simplified success message
                resolve({ status: `🟢 ACCESSIBLE` });
              })
              .catch(() => {
                resolve({ status: '🔴 BLOCKED' });
              });
          } else {
            // Try HTTP as a fallback
            axios({ ...options, url: `http://${domain}` })
              .then((response) => {
                resolve({ status: `🟢 ACCESSIBLE` });
              })
              .catch(() => {
                resolve({ status: '🔴 BLOCKED' });
              });
          }
        });
    });
  });
}

// SSE endpoint for real-time results
app.get('/api/sse', (req, res) => {
  // Set headers for SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  // Send a comment to keep the connection alive
  const keepAlive = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 15000);

  // Store the response object in a global map with a unique client ID
  const clientId = Date.now();
  activeConnections[clientId] = res;

  // Clean up on client disconnect
  req.on('close', () => {
    clearInterval(keepAlive);
    delete activeConnections[clientId];
  });
});

// Store active SSE connections
const activeConnections = {};

// Send an event to all connected clients
function sendSSEEvent(eventData) {
  const data = JSON.stringify(eventData);
  for (const clientId in activeConnections) {
    activeConnections[clientId].write(`data: ${data}\n\n`);
  }
}

app.post('/api/check-domain', async (req, res) => {
  const { domains, simConfigs } = req.body;
  const results = [];
  const totalChecks = domains.length * Object.keys(simConfigs).length;
  let completedChecks = 0;

  // Send initial response to client
  res.json({ message: 'Check started', totalChecks });

  // Process domains asynchronously
  for (const domain of domains) {
    for (const [sim, iface] of Object.entries(simConfigs)) {
      // Use an IIFE to create a closure for each check
      (async () => {
        const localIP = getInterfaceIP(iface);
        let result;

        if (!localIP) {
          result = {
            domain,
            sim,
            interface: iface,
            status: 'Invalid Interface'
          };
        } else {
          const checkResult = await checkDomain(domain, localIP);
          result = {
            domain,
            sim,
            interface: iface,
            status: checkResult.status
          };
        }

        // Send the individual result via SSE
        sendSSEEvent({ type: 'result', data: result });
        
        // Track progress
        completedChecks++;
        if (completedChecks === totalChecks) {
          sendSSEEvent({ type: 'complete' });
        }

        results.push(result);
      })();
    }
  }
});

app.listen(PORT, () => {
  console.log(`✅ API running at http://localhost:${PORT}`);
});
