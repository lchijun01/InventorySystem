const express = require('express');
const path = require('path');
const db = require('./db');

const app = express();

// Middleware to parse URL-encoded form data
app.use(express.urlencoded({ extended: true }));

// Set EJS as the templating engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware to serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Route to display the main stock list page
app.get('/', (req, res) => {
    res.render('index');
});

// Route to check if a category name exists (case insensitive)
app.get('/check-category', (req, res) => {
    const { name, excludeId } = req.query;
    let sql = 'SELECT * FROM categories WHERE LOWER(name) = LOWER(?)';
    let params = [name];

    if (excludeId) {
        sql += ' AND id != ?';
        params.push(excludeId);
    }

    db.query(sql, params, (err, results) => {
        if (err) throw err;
        if (results.length > 0) {
            res.json({ exists: true });
        } else {
            res.json({ exists: false });
        }
    });
});
// Route to handle category creation
app.post('/add-category', (req, res) => {
    const { category_name } = req.body;
    const sql = 'INSERT INTO categories (name) VALUES (?)';
    db.query(sql, [category_name], (err, result) => {
        if (err) throw err;
        res.redirect(`/categories?success=${encodeURIComponent(`Category "${category_name}" added successfully!`)}`);
    });
});
app.get('/check-product', (req, res) => {
    const productName = req.query.name;

    const sql = 'SELECT COUNT(*) AS count FROM product_list WHERE product_name = ?';
    db.query(sql, [productName], (err, results) => {
        if (err) {
            return res.status(500).json({ exists: false, error: 'Database error' });
        }

        const exists = results[0].count > 0;
        res.json({ exists });
    });
});



// Route to handle product creation
app.get('/add-product', (req, res) => {
    const successMessage = req.query.success;
    const sql = 'SELECT * FROM categories';
    db.query(sql, (err, categories) => {
        if (err) throw err;
        res.render('addproduct', { title: 'Add New Product', categories, success: successMessage });
    });
});
app.post('/add-product', (req, res) => {
    const { product_name, category_id, skus } = req.body;

    // Insert the product into the product_list table with category_id
    const productSql = 'INSERT INTO product_list (product_name, category_id) VALUES (?, ?)';
    db.query(productSql, [product_name, category_id], (err, result) => {
        if (err) throw err;

        const productId = result.insertId; // Get the newly inserted product ID

        // Prepare the SKUs to be inserted
        const skuSql = 'INSERT INTO sku_list (sku_name, product_id) VALUES ?';
        const skuValues = skus.map(sku => [sku, productId]);

        // Insert the SKUs into the sku_list table
        db.query(skuSql, [skuValues], (err, result) => {
            if (err) throw err;
            res.redirect(`/add-product?success=${encodeURIComponent(`Product "${product_name}" added successfully!`)}`);
        });
    });
});
// Route to manage products
app.get('/products', (req, res) => {
    let selectedCategories = req.query.categories || [];

    // Ensure selectedCategories is an array
    if (!Array.isArray(selectedCategories)) {
        selectedCategories = [selectedCategories];
    }

    let sql = `
        SELECT p.id AS product_id, p.product_name, c.name AS category_name, s.sku_name
        FROM product_list p
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN sku_list s ON p.id = s.product_id
    `;

    if (selectedCategories.length > 0) {
        sql += ` WHERE c.id IN (${selectedCategories.map(() => '?').join(',')})`;
    }

    sql += ' ORDER BY p.product_name, s.sku_name';

    db.query(sql, selectedCategories, (err, stock) => {
        if (err) throw err;

        db.query('SELECT * FROM categories', (err, categories) => {
            if (err) throw err;

            res.render('products', { title: 'Manage Products', stock, categories, selectedCategories });
        });
    });
});
app.get('/edit-product/:id', (req, res) => {
    const productId = req.params.id;

    // Query to get the product details and SKUs
    const sqlGetProduct = `
        SELECT p.id AS product_id, p.product_name, c.id AS category_id, c.name AS category_name, s.id AS sku_id, s.sku_name
        FROM product_list p
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN sku_list s ON p.id = s.product_id
        WHERE p.id = ?
    `;

    db.query(sqlGetProduct, [productId], (err, results) => {
        if (err) throw err;

        if (results.length === 0) {
            return res.send('Product not found');
        }

        // Extract product details (from the first row) and SKUs
        const product = {
            product_id: results[0].product_id,
            product_name: results[0].product_name,
            category_id: results[0].category_id,
        };

        const skus = results.map(row => ({
            sku_id: row.sku_id,
            sku_name: row.sku_name,
        }));

        // Query to get all categories
        db.query('SELECT * FROM categories', (err, categories) => {
            if (err) throw err;

            // Render the edit form with the product, its SKUs, and all categories
            res.render('editproduct', { title: 'Edit Product', product, categories, skus });
        });
    });
});
app.post('/edit-product/:id', (req, res) => {
    const productId = req.params.id;
    const { product_name, category_id, skus, sku_ids, new_skus, deleted_skus } = req.body;

    // Update the product details
    const sqlUpdateProduct = 'UPDATE product_list SET product_name = ?, category_id = ? WHERE id = ?';
    db.query(sqlUpdateProduct, [product_name, category_id, productId], (err, result) => {
        if (err) throw err;

        // Update the existing SKUs
        if (sku_ids && skus) {
            const sqlUpdateSku = 'UPDATE sku_list SET sku_name = ? WHERE id = ?';
            sku_ids.forEach((skuId, index) => {
                db.query(sqlUpdateSku, [skus[index], skuId], (err, result) => {
                    if (err) throw err;
                });
            });
        }

        // Add new SKUs
        if (new_skus && Array.isArray(new_skus)) {
            const sqlInsertSku = 'INSERT INTO sku_list (sku_name, product_id) VALUES ?';
            const newSkuValues = new_skus.map(skuName => [skuName, productId]);
            if (newSkuValues.length > 0) {
                db.query(sqlInsertSku, [newSkuValues], (err, result) => {
                    if (err) throw err;
                });
            }
        }

        // Handle deletion of SKUs
        if (deleted_skus) {
            const deletedSkuIds = deleted_skus.split(',').map(Number).filter(id => id);
            if (deletedSkuIds.length > 0) {
                const sqlDeleteSku = 'DELETE FROM sku_list WHERE id IN (?)';
                db.query(sqlDeleteSku, [deletedSkuIds], (err, result) => {
                    if (err) throw err;
                });
            }
        }

        res.redirect('/products');
    });
});
app.post('/delete-product/:id', (req, res) => {
    const productId = req.params.id;

    // SQL query to delete all SKUs associated with the product
    const sqlDeleteSkus = 'DELETE FROM sku_list WHERE product_id = ?';

    // SQL query to delete the product itself
    const sqlDeleteProduct = 'DELETE FROM product_list WHERE id = ?';

    // First, delete the SKUs
    db.query(sqlDeleteSkus, [productId], (err, result) => {
        if (err) throw err;

        // Then, delete the product
        db.query(sqlDeleteProduct, [productId], (err, result) => {
            if (err) throw err;

            // Redirect back to the stock check page after deletion
            res.redirect('/products');
        });
    });
});
// Route to display all categories
app.get('/categories', (req, res) => {
    const successMessage = req.query.success;
    const sql = 'SELECT * FROM categories ORDER BY name';
    db.query(sql, (err, results) => {
        if (err) throw err;
        res.render('categories', { title: 'Categories List', categories: results, success: successMessage });
    });
});
app.get('/edit-category/:id', (req, res) => {
    const categoryId = req.params.id;
    const sql = 'SELECT * FROM categories WHERE id = ?';
    db.query(sql, [categoryId], (err, results) => {
        if (err) throw err;
        if (results.length > 0) {
            res.render('editcategory', { title: 'Edit Category', category: results[0], error: null });
        } else {
            res.send('Category not found');
        }
    });
});
app.post('/edit-category/:id', (req, res) => {
    const categoryId = req.params.id;
    const { category_name } = req.body;

    // Check if the new category name already exists (excluding the current one)
    const checkSql = 'SELECT * FROM categories WHERE LOWER(name) = LOWER(?) AND id != ?';
    db.query(checkSql, [category_name, categoryId], (err, results) => {
        if (err) throw err;
        if (results.length > 0) {
            // Category name already exists
            const sql = 'SELECT * FROM categories WHERE id = ?';
            db.query(sql, [categoryId], (err, categoryResults) => {
                if (err) throw err;
                res.render('editcategory', { title: 'Edit Category', category: categoryResults[0], error: 'Category name already exists!' });
            });
        } else {
            // Update the category name
            const updateSql = 'UPDATE categories SET name = ? WHERE id = ?';
            db.query(updateSql, [category_name, categoryId], (err, result) => {
                if (err) throw err;
                res.redirect('/categories');  // Redirect to the category list or another page
            });
        }
    });
});
app.delete('/delete-category/:id', (req, res) => {
    const categoryId = req.params.id;

    // Query to count the number of products using the category
    db.query('SELECT COUNT(*) AS productCount FROM product_list WHERE category_id = ?', [categoryId], (err, results) => {
        if (err) {
            console.error('Error counting products:', err);
            return res.status(500).json({ error: 'Server error' });
        }

        const productCount = results[0].productCount;

        if (productCount > 0) {
            // Warn the user if there are products using this category
            res.json({ error: `Cannot delete this category. There are ${productCount} products using it.` });
        } else {
            // No products are using this category, so it's safe to delete
            db.query('DELETE FROM categories WHERE id = ?', [categoryId], (err, result) => {
                if (err) {
                    console.error('Error deleting category:', err);
                    return res.status(500).json({ error: 'Server error' });
                }

                res.json({ success: 'Category deleted successfully' });
            });
        }
    });
});

app.get('/purchase', (req, res) => {
    // Fetch products and suppliers
    db.query('SELECT id, product_name FROM product_list', (err, products) => {
        if (err) {
            console.error('Error fetching products:', err);
            return res.status(500).send('Server error');
        }

        db.query('SELECT id, name FROM suppliers', (err, suppliers) => {
            if (err) {
                console.error('Error fetching suppliers:', err);
                return res.status(500).send('Server error');
            }

            res.render('purchase_stock', { products, suppliers });
        });
    });
});
// Route to get SKUs based on the selected product
app.get('/get-skus/:productId', (req, res) => {
    const productId = req.params.productId;
    db.query('SELECT * FROM sku_list WHERE product_id = ?', [productId], (err, skus) => {
        if (err) {
            console.error('Error fetching SKUs:', err);
            return res.status(500).send('Server error');
        }
        res.json(skus);
    });
});
// Function to generate an invoice
function generateInvoice() {
    return 'INV-' + Date.now(); // Simple invoice generation
}
// Route to handle the purchase form submission
app.post('/purchase-stock', async (req, res) => {
    try {
        const { supplier_id, buy_date, paid, paid_by, products } = req.body;

        console.log("Request body:", req.body); // Log the entire request body

        // Generate the invoice
        const invoice = generateInvoice();

        // Collect all database operations into an array
        const insertPromises = products.map(product => {
            const { product_id, skus } = product;

            return skus.map(sku => {
                const { id: sku_id, quantity, buyprice } = sku;

                console.log("Processing SKU ID:", sku_id, "with quantity:", quantity); // Log each SKU ID and quantity

                // Check if the quantity is greater than 0 and the SKU ID is valid
                if (quantity && quantity > 0 && sku_id) {
                    // Determine the values for paid and paid_by
                    const isPaid = paid ? "true" : "false";
                    const paymentMethod = paid ? paid_by : null;

                    // Return a promise for the insert operation
                    return new Promise((resolve, reject) => {
                        db.query(
                            'INSERT INTO purchase (invoice, supplier_id, product_id, sku_id, quantity, buyprice, buy_date, paid, paid_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                            [invoice, supplier_id, product_id, sku_id, quantity, buyprice, buy_date, isPaid, paymentMethod],
                            (err, result) => {
                                if (err) {
                                    reject(err);
                                } else {
                                    resolve(result);
                                }
                            }
                        );
                    });
                }
            });
        }).flat(); // Flatten the array of arrays

        // Execute all insert operations
        await Promise.all(insertPromises);

        // After all inserts, redirect back to the purchase page
        res.redirect('/purchase');
    } catch (err) {
        console.error('Error inserting purchase record:', err);
        if (!res.headersSent) {
            res.status(500).send('Server error');
        }
    }
});
app.get('/get-location/:postcode', (req, res) => {
    const postcode = req.params.postcode;
    const query = `
        SELECT p.post_office, s.state_name 
        FROM postcode p
        JOIN state s ON p.state_code = s.state_code
        WHERE p.postcode = ?`;

    db.query(query, [postcode], (err, results) => {
        if (err) {
            console.error('Error fetching location:', err);
            return res.status(500).send('Server error');
        }

        if (results.length > 0) {
            res.json(results[0]);
        } else {
            res.json({ state_name: '', post_office: '' });
        }
    });
});
// Route to render the manage supplier page
app.get('/manage-suppliers', (req, res) => {
    db.query('SELECT * FROM suppliers', (err, suppliers) => {
        if (err) {
            console.error('Error fetching suppliers:', err);
            return res.status(500).send('Server error');
        }
        res.render('manage_supplier', { suppliers });
    });
});
// Route to handle supplier form submission
app.post('/add-supplier', (req, res) => {
    const { name, phone, email, state, zip, address1, address2, address3, post_office } = req.body;

    db.query(
        'INSERT INTO suppliers (name, phone, email, state, zip, address1, address2, address3, post_office) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [name, phone, email, state, zip, address1, address2, address3, post_office],
        (err, result) => {
            if (err) {
                console.error('Error adding supplier:', err);
                return res.status(500).send('Server error');
            }

            res.redirect('/manage-suppliers');
        }
    );
});
// Route to fetch a single supplier by ID for editing
app.get('/get-supplier/:id', (req, res) => {
    const supplierId = req.params.id;
    db.query('SELECT * FROM suppliers WHERE id = ?', [supplierId], (err, result) => {
        if (err) {
            console.error('Error fetching supplier:', err);
            return res.status(500).send('Server error');
        }
        res.json(result[0]);
    });
});
// Route to update a supplier
app.post('/update-supplier/:id', (req, res) => {
    const supplierId = req.params.id;
    const { name, phone, email, zip, state, post_office, address1, address2, address3 } = req.body;
    const query = `
        UPDATE suppliers 
        SET name = ?, phone = ?, email = ?, zip = ?, state = ?, post_office = ?, address1 = ?, address2 = ?, address3 = ? 
        WHERE id = ?`;

    db.query(query, [name, phone, email, zip, state, post_office, address1, address2, address3, supplierId], (err, result) => {
        if (err) {
            console.error('Error updating supplier:', err);
            return res.status(500).send('Server error');
        }
        res.redirect('/manage-suppliers');
    });
});
// Route to delete a supplier
app.delete('/delete-supplier/:id', (req, res) => {
    const supplierId = req.params.id;
    db.query('DELETE FROM suppliers WHERE id = ?', [supplierId], (err, result) => {
        if (err) {
            console.error('Error deleting supplier:', err);
            return res.status(500).send('Server error');
        }
        res.sendStatus(204); // No Content
    });
});


// Sales
app.get('/sales', (req, res) => {
    res.render('sales' ,{ title: 'Sales' });
});


// Stock Check
app.get('/stock-check', (req, res) => {
    res.render('stock_check' ,{ title: 'Stock Check' });
});



// Start the server
const port = 3000;
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
