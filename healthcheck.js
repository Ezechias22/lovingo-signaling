// signaling_server/healthcheck.js - SCRIPT DE VÉRIFICATION DE SANTÉ
const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;
const TIMEOUT = 5000;

// Vérification HTTP
function checkHTTP() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: PORT,
      path: '/health',
      method: 'GET',
      timeout: TIMEOUT,
    };

    const req = http.request(options, (res) => {
      if (res.statusCode === 200) {
        resolve('HTTP OK');
      } else {
        reject(new Error(`HTTP ${res.statusCode}`));
      }
    });

    req.on('error', reject);
    req.on('timeout', () => reject(new Error('HTTP Timeout')));
    req.end();
  });
}

// Vérification WebSocket
function checkWebSocket() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${PORT}`);
    
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('WebSocket Timeout'));
    }, TIMEOUT);

    ws.on('open', () => {
      clearTimeout(timeout);
      ws.close();
      resolve('WebSocket OK');
    });

    ws.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

// Vérifications principales
async function healthCheck() {
  try {
    console.log('🏥 Vérification de santé du serveur...');
    
    // Vérifier HTTP
    const httpResult = await checkHTTP();
    console.log(`✅ ${httpResult}`);
    
    // Vérifier WebSocket
    const wsResult = await checkWebSocket();
    console.log(`✅ ${wsResult}`);
    
    // Vérifier la mémoire
    const memUsage = process.memoryUsage();
    const memUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const memTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
    
    console.log(`💾 Mémoire: ${memUsedMB}MB / ${memTotalMB}MB`);
    
    if (memUsedMB > 400) {
      throw new Error(`Utilisation mémoire trop élevée: ${memUsedMB}MB`);
    }
    
    // Vérifier l'uptime
    const uptimeMinutes = Math.round(process.uptime() / 60);
    console.log(`⏱️ Uptime: ${uptimeMinutes} minutes`);
    
    console.log('✅ Serveur en bonne santé');
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Problème de santé détecté:', error.message);
    process.exit(1);
  }
}

// Exécuter la vérification
healthCheck();