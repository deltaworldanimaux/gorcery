require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;

const app = express();
const PORT = process.env.PORT || 3000;

// Enhanced CORS for Replit
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Data storage
const STORES_FILE = './data/stores.json';
const ORDERS_FILE = './data/orders.json';
const PRODUCTS_FILE = './data/products.json';

// Ensure data directory exists
async function ensureDataDir() {
    try {
        await fs.mkdir('./data', { recursive: true });
        
        // Initialize files if they don't exist
        const files = {
            [STORES_FILE]: [],
            [ORDERS_FILE]: [],
            [PRODUCTS_FILE]: []
        };

        for (const [filePath, defaultValue] of Object.entries(files)) {
            try {
                await fs.access(filePath);
            } catch {
                await fs.writeFile(filePath, JSON.stringify(defaultValue, null, 2));
                console.log(`Created ${filePath}`);
            }
        }
    } catch (error) {
        console.error('Error initializing data directory:', error);
    }
}

// Data management functions
async function readJSON(file) {
    try {
        const data = await fs.readFile(file, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return [];
    }
}

async function writeJSON(file, data) {
    await fs.writeFile(file, JSON.stringify(data, null, 2));
}

// ========== API ROUTES ==========

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        message: 'Main Store Server is running on Replit!',
        timestamp: new Date().toISOString(),
        replit: true
    });
});

// Store registration - FIXED ENDPOINT
app.post('/api/stores/register', async (req, res) => {
    try {
        const storeInfo = req.body;
        
        console.log('📝 Store registration received:', storeInfo);
        
        // Validate required fields
        if (!storeInfo.storeId || !storeInfo.name) {
            return res.status(400).json({ 
                error: 'Missing required fields: storeId and name are required' 
            });
        }

        storeInfo.lastSeen = new Date().toISOString();
        storeInfo.status = 'online';
        storeInfo.registeredAt = new Date().toISOString();

        const stores = await readJSON(STORES_FILE);
        const existingIndex = stores.findIndex(s => s.storeId === storeInfo.storeId);

        if (existingIndex > -1) {
            stores[existingIndex] = { ...stores[existingIndex], ...storeInfo };
            console.log('✅ Updated existing store:', storeInfo.storeId);
        } else {
            stores.push(storeInfo);
            console.log('✅ Added new store:', storeInfo.storeId);
        }

        await writeJSON(STORES_FILE, stores);
        
        res.json({ 
            success: true, 
            store: storeInfo,
            message: 'Store registered successfully with Replit server',
            totalStores: stores.length
        });
        
    } catch (error) {
        console.error('❌ Store registration error:', error);
        res.status(500).json({ 
            error: 'Failed to register store',
            details: error.message 
        });
    }
});

// Get all stores
app.get('/api/stores', async (req, res) => {
    try {
        const stores = await readJSON(STORES_FILE);
        
        // Update online status based on last seen
        const now = new Date();
        stores.forEach(store => {
            const lastSeen = new Date(store.lastSeen);
            const minutesAgo = (now - lastSeen) / (1000 * 60);
            store.status = minutesAgo < 10 ? 'online' : 'offline';
        });

        await writeJSON(STORES_FILE, stores);
        res.json(stores);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch stores' });
    }
});

// Debug endpoint to see all stores
app.get('/api/debug/stores', async (req, res) => {
    try {
        const stores = await readJSON(STORES_FILE);
        const storesWithStatus = stores.map(store => {
            const lastSeen = new Date(store.lastSeen);
            const minutesAgo = (Date.now() - lastSeen) / (1000 * 60);
            return {
                ...store,
                status: minutesAgo < 10 ? 'online' : 'offline',
                minutesSinceLastSeen: Math.floor(minutesAgo)
            };
        });

        res.json({
            server: 'Replit Main Server',
            totalStores: storesWithStatus.length,
            onlineStores: storesWithStatus.filter(s => s.status === 'online').length,
            stores: storesWithStatus
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Manual store addition
app.post('/api/stores/manual-add', async (req, res) => {
    try {
        const { storeId, name, location, url } = req.body;
        
        if (!storeId || !name) {
            return res.status(400).json({ error: 'storeId and name are required' });
        }

        const storeInfo = {
            storeId,
            name,
            location: location || 'Unknown Location',
            url: url || `http://localhost:3000`,
            lastSeen: new Date().toISOString(),
            status: 'online'
        };

        const stores = await readJSON(STORES_FILE);
        const existingIndex = stores.findIndex(s => s.storeId === storeId);

        if (existingIndex > -1) {
            stores[existingIndex] = storeInfo;
        } else {
            stores.push(storeInfo);
        }

        await writeJSON(STORES_FILE, stores);
        
        res.json({ 
            success: true, 
            message: 'Store added manually',
            store: storeInfo
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Test endpoint
app.get('/api/test', (req, res) => {
    res.json({ 
        message: 'API is working!',
        endpoint: '/api/stores/register is available',
        timestamp: new Date().toISOString()
    });
});

// Sync products from a store
app.post('/api/stores/:storeId/sync-products', async (req, res) => {
    try {
        const { storeId } = req.params;
        const stores = await readJSON(STORES_FILE);
        const store = stores.find(s => s.storeId === storeId);

        if (!store) {
            return res.status(404).json({ error: 'Store not found' });
        }

        // Fetch products from store
        const response = await fetch(`${store.url}/api/products`);
        if (!response.ok) throw new Error('Failed to fetch products from store');

        const products = await response.json();
        
        // Update main products database
        const allProducts = await readJSON(PRODUCTS_FILE);
        const otherStoreProducts = allProducts.filter(p => p.storeId !== storeId);
        const updatedProducts = [...otherStoreProducts, ...products];
        
        await writeJSON(PRODUCTS_FILE, updatedProducts);
        
        res.json({ 
            success: true, 
            productsCount: products.length,
            store: store.name
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to sync products: ' + error.message });
    }
});

// Get all products
app.get('/api/products', async (req, res) => {
    try {
        const products = await readJSON(PRODUCTS_FILE);
        res.json(products);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch products' });
    }
});

// Create order
app.post('/api/orders', async (req, res) => {
    try {
        const order = req.body;
        
        if (!order.storeId || !order.items || !order.customer) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Generate order ID
        order.orderId = `MAIN-ORD-${Date.now()}`;
        order.createdAt = new Date().toISOString();
        order.status = 'pending';

        // Get store info
        const stores = await readJSON(STORES_FILE);
        const store = stores.find(s => s.storeId === order.storeId);
        
        if (!store) {
            return res.status(404).json({ error: 'Store not found' });
        }

        order.storeName = store.name;

        // Save to main server
        const orders = await readJSON(ORDERS_FILE);
        orders.push(order);
        await writeJSON(ORDERS_FILE, orders);

        res.status(201).json({ success: true, order });
    } catch (error) {
        res.status(500).json({ error: 'Failed to create order' });
    }
});

// Get orders
app.get('/api/orders', async (req, res) => {
    try {
        const orders = await readJSON(ORDERS_FILE);
        res.json(orders);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch orders' });
    }
});

// ========== STATIC FILES ==========
app.use(express.static('public'));

// HTML routes
app.get('/', (req, res) => {
    res.json({
        message: '🏪 Main Store Server - Replit Edition',
        endpoints: {
            health: '/api/health',
            test: '/api/test',
            stores: '/api/stores',
            registerStore: '/api/stores/register (POST)',
            debug: '/api/debug/stores',
            products: '/api/products',
            orders: '/api/orders'
        },
        note: 'API endpoints are working!',
        timestamp: new Date().toISOString()
    });
});

app.get('/stores', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/stores.html'));
});

app.get('/orders', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/orders.html'));
});

app.get('/store-management', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/store-management.html'));
});

// ========== ERROR HANDLING ==========

// 404 handler for all other routes - FIXED: Use regex instead of wildcard
app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
        // API 404
        res.status(404).json({ 
            error: 'API endpoint not found',
            path: req.originalUrl,
            availableEndpoints: [
                'GET  /api/health',
                'GET  /api/test', 
                'GET  /api/stores',
                'POST /api/stores/register',
                'GET  /api/debug/stores',
                'POST /api/stores/manual-add',
                'GET  /api/products',
                'POST /api/orders',
                'GET  /api/orders'
            ]
        });
    } else {
        // HTML 404
        res.status(404).json({
            error: 'Page not found',
            path: req.originalUrl,
            availablePages: [
                '/',
                '/stores', 
                '/orders',
                '/store-management'
            ]
        });
    }
});

// Global error handler
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({ 
        error: 'Internal server error',
        message: error.message 
    });
});

// Initialize and start server
ensureDataDir().then(() => {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🏪 Main server running on Replit!`);
        console.log(`📍 Port: ${PORT}`);
        console.log(`✅ Health check: /api/health`);
        console.log(`✅ Test endpoint: /api/test`);
        console.log(`✅ Store registration: /api/stores/register`);
        console.log(`🛍️ Main store: /`);
    });
}).catch(error => {
    console.error('Failed to start server:', error);
});