require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;

const app = express();
// Replit uses its own port, so we don't specify one
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

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        message: 'Main Store Server is running on Replit!',
        timestamp: new Date().toISOString(),
        replit: true
    });
});

// Store registration - Enhanced for Replit
app.post('/api/stores/register', async (req, res) => {
    try {
        const storeInfo = req.body;
        
        // Validate required fields
        if (!storeInfo.storeId || !storeInfo.name || !storeInfo.url) {
            return res.status(400).json({ 
                error: 'Missing required fields: storeId, name, and url are required' 
            });
        }

        storeInfo.lastSeen = new Date().toISOString();
        storeInfo.status = 'online';
        storeInfo.registeredAt = storeInfo.registeredAt || new Date().toISOString();

        console.log('📝 Store registration received on Replit:', {
            storeId: storeInfo.storeId,
            name: storeInfo.name,
            url: storeInfo.url
        });

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
            totalStores: stores.length,
            server: 'replit'
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
        
        // Update online status based on last seen (10 minutes threshold for Replit)
        const now = new Date();
        stores.forEach(store => {
            const lastSeen = new Date(store.lastSeen);
            const minutesAgo = (now - lastSeen) / (1000 * 60);
            store.status = minutesAgo < 10 ? 'online' : 'offline';
            store.lastSeenMinutes = Math.floor(minutesAgo);
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
                minutesSinceLastSeen: Math.floor(minutesAgo),
                server: 'replit'
            };
        });

        res.json({
            server: 'Replit Main Server',
            totalStores: storesWithStatus.length,
            onlineStores: storesWithStatus.filter(s => s.status === 'online').length,
            replitUrl: process.env.REPLIT_URL || 'https://your-replit-url.repl.co',
            stores: storesWithStatus
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/test', (req, res) => {
    res.json({ 
        message: 'API is working!',
        endpoint: '/api/stores/register is available',
        timestamp: new Date().toISOString()
    });
});
// Manual store addition endpoint
app.post('/api/stores/manual-add', async (req, res) => {
    try {
        const { storeId, name, location, url } = req.body;
        
        if (!storeId || !name || !url) {
            return res.status(400).json({ error: 'storeId, name, and url are required' });
        }

        const storeInfo = {
            storeId,
            name,
            location: location || 'Unknown Location',
            url,
            lastSeen: new Date().toISOString(),
            status: 'online',
            addedManually: true
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
            message: 'Store added manually to Replit server',
            store: storeInfo
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
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

// Sync all stores products
app.post('/api/stores/sync-all', async (req, res) => {
    try {
        const stores = await readJSON(STORES_FILE);
        const onlineStores = stores.filter(s => s.status === 'online');
        let totalProducts = 0;
        let syncedStores = 0;

        for (const store of onlineStores) {
            try {
                const response = await fetch(`${store.url}/api/products`);
                if (response.ok) {
                    const products = await response.json();
                    
                    const allProducts = await readJSON(PRODUCTS_FILE);
                    const otherStoreProducts = allProducts.filter(p => p.storeId !== store.storeId);
                    const updatedProducts = [...otherStoreProducts, ...products];
                    
                    await writeJSON(PRODUCTS_FILE, updatedProducts);
                    
                    totalProducts += products.length;
                    syncedStores++;
                }
            } catch (error) {
                console.error(`Failed to sync store ${store.name}:`, error.message);
            }
        }

        res.json({ 
            success: true, 
            syncedStores,
            totalProducts,
            message: `تم مزامنة ${syncedStores} متاجر بـ ${totalProducts} منتج`
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to sync all stores' });
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

// Get product categories
app.get('/api/categories', async (req, res) => {
    try {
        const products = await readJSON(PRODUCTS_FILE);
        const categories = [...new Set(products.map(p => p.category).filter(Boolean))];
        res.json(categories);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch categories' });
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

app.use(express.static('public'));

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

// 404 handler for API routes
app.use('/api/*', (req, res) => {
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
            'POST /api/orders'
        ]
    });
});

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

// Update order status
app.put('/api/orders/:orderId/status', async (req, res) => {
    try {
        const { orderId } = req.params;
        const { status, storeId, notes } = req.body;

        const orders = await readJSON(ORDERS_FILE);
        const orderIndex = orders.findIndex(o => o.orderId === orderId);

        if (orderIndex === -1) {
            return res.status(404).json({ error: 'Order not found' });
        }

        orders[orderIndex].status = status;
        orders[orderIndex].notes = notes || orders[orderIndex].notes;
        orders[orderIndex].updatedAt = new Date().toISOString();

        await writeJSON(ORDERS_FILE, orders);
        res.json({ success: true, order: orders[orderIndex] });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update order status' });
    }
});

// Get orders
app.get('/api/orders', async (req, res) => {
    try {
        const { storeId, status } = req.query;
        let orders = await readJSON(ORDERS_FILE);

        if (storeId) {
            orders = orders.filter(o => o.storeId === storeId);
        }

        if (status && status !== 'all') {
            orders = orders.filter(o => o.status === status);
        }

        // Sort by creation date (newest first)
        orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        res.json(orders);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch orders' });
    }
});
