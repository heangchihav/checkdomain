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
      if (err) return resolve({ status: 'DNS Error' });

      // Use axios to handle redirects automatically
      const options = {
        method: 'GET',
        url: `https://${domain}`,
        timeout: 5000,
        localAddress
      };

      axios(options)
        .then((response) => {
          resolve({ status: `🟢 HTTPS ${response.status}` });
        })
        .catch((error) => {
          if (error.response && error.response.status) {
            // Handle if it fails to get HTTPS, try HTTP
            axios({ ...options, url: `http://${domain}` })
              .then((response) => {
                resolve({ status: `🟢 HTTP ${response.status}` });
              })
              .catch(() => {
                resolve({ status: '🔴 HTTP Failed' });
              });
          } else {
            resolve({ status: '🔴 HTTPS Failed' });
          }
        });
    });
  });
}

app.post('/api/check-domain', async (req, res) => {
  const { domains, simConfigs } = req.body;
  const results = [];

  for (const domain of domains) {
    for (const [sim, iface] of Object.entries(simConfigs)) {
      const localIP = getInterfaceIP(iface);

      if (!localIP) {
        results.push({
          domain,
          sim,
          interface: iface,
          status: 'Invalid Interface'
        });
        continue;
      }

      const result = await checkDomain(domain, localIP);

      results.push({
        domain,
        sim,
        interface: iface,
        status: result.status
      });
    }
  }

  res.json({ results });
});

app.listen(PORT, () => {
  console.log(`✅ API running at http://localhost:${PORT}`);
});
