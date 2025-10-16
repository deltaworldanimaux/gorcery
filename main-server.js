require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Data storage
const STORES_FILE = './data/stores.json';
const ORDERS_FILE = './data/orders.json';
const PRODUCTS_FILE = './data/products.json';

// Ensure data directory exists
async function ensureDataDir() {
    try {
        await fs.mkdir('./data', { recursive: true });
        
        // Initialize files if they don't exist
        try {
            await fs.access(STORES_FILE);
        } catch {
            await fs.writeFile(STORES_FILE, JSON.stringify([]));
        }
        
        try {
            await fs.access(ORDERS_FILE);
        } catch {
            await fs.writeFile(ORDERS_FILE, JSON.stringify([]));
        }
        
        try {
            await fs.access(PRODUCTS_FILE);
        } catch {
            await fs.writeFile(PRODUCTS_FILE, JSON.stringify([]));
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

// Store registration
// Enhanced store registration endpoint
app.post('/api/stores/register', async (req, res) => {
  try {
    const storeInfo = req.body;
    storeInfo.lastSeen = new Date().toISOString();
    storeInfo.status = 'online';

    console.log('📝 Store registration received:', {
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
    
    // Test store connectivity
    try {
      const testResponse = await fetch(`${storeInfo.url}/api/debug`, { timeout: 5000 });
      if (testResponse.ok) {
        storeInfo.connectivity = 'good';
        console.log('✅ Store connectivity test passed');
      } else {
        storeInfo.connectivity = 'poor';
        console.log('⚠️ Store connectivity test failed');
      }
    } catch (connectError) {
      storeInfo.connectivity = 'failed';
      console.log('❌ Store connectivity test error:', connectError.message);
    }

    res.json({ 
      success: true, 
      store: storeInfo,
      message: 'Store registered successfully'
    });
  } catch (error) {
    console.error('❌ Store registration error:', error);
    res.status(500).json({ 
      error: 'Failed to register store',
      details: error.message 
    });
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
        status: minutesAgo < 5 ? 'online' : 'offline',
        minutesSinceLastSeen: Math.floor(minutesAgo)
      };
    });

    res.json({
      totalStores: storesWithStatus.length,
      onlineStores: storesWithStatus.filter(s => s.status === 'online').length,
      stores: storesWithStatus
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
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

// Get all stores
app.get('/api/stores', async (req, res) => {
    try {
        const stores = await readJSON(STORES_FILE);
        
        // Update online status based on last seen (5 minutes threshold)
        const now = new Date();
        stores.forEach(store => {
            const lastSeen = new Date(store.lastSeen);
            const minutesAgo = (now - lastSeen) / (1000 * 60);
            store.status = minutesAgo < 5 ? 'online' : 'offline';
        });

        await writeJSON(STORES_FILE, stores);
        res.json(stores);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch stores' });
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
        const { storeId, category, search } = req.query;
        let products = await readJSON(PRODUCTS_FILE);

        if (storeId) {
            products = products.filter(p => p.storeId === storeId);
        }

        if (category && category !== 'all') {
            products = products.filter(p => p.category === category);
        }

        if (search) {
            const searchTerm = search.toLowerCase();
            products = products.filter(p => 
                p.name.toLowerCase().includes(searchTerm) ||
                p.category.toLowerCase().includes(searchTerm)
            );
        }

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

        // Send to local store
        try {
            const storeResponse = await fetch(`${store.url}/api/orders`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(order)
            });

            if (!storeResponse.ok) {
                throw new Error('Store rejected the order');
            }
        } catch (error) {
            console.error('Failed to send order to store:', error);
            // Continue anyway - the order is saved on main server
        }

        res.status(201).json({ success: true, order });
    } catch (error) {
        res.status(500).json({ error: 'Failed to create order' });
    }
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

// Serve main app
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/index.html'));
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


// Initialize and start server
ensureDataDir().then(() => {
    app.listen(PORT, () => {
        console.log(`🏪 Main server running on port ${PORT}`);
        console.log(`📍 Access the main dashboard: http://localhost:${PORT}`);
    });
});