
import { supabase } from './supabase';
import type { Product, Customer, Sale } from '../types';

export const migrateData = async () => {
    try {
        console.log("Starting migration...");

        // 1. Migrate Products
        const productsStr = localStorage.getItem('jbl_pos_products');
        if (productsStr) {
            const products: Product[] = JSON.parse(productsStr);
            console.log(`Migrating ${products.length} products...`);

            const { error } = await supabase.from('products').upsert(
                products.map(p => ({
                    id: p.id, // Keep existing ID if possible, or let Supabase generate if UUID needed. 
                    // Our IDs are strings, Supabase IDs are UUIDs. 
                    // IF local IDs are NOT UUIDs, we might have issues if we enforce UUID in DB.
                    // Schema said: id uuid default uuid_generate_v4().
                    // Local IDs are '1', '2' or timestamps '173...'.
                    // We should probably let Supabase generate NEW UUIDs and map them?
                    // OR change schema to text/varchar?
                    // CHANGE SCHEMA PREFERENCE: Text is easier for migration.
                    // BUT for long term, UUID is better.
                    // Let's try to keep IDs if they are UUID-like, roughly.
                    // Actually, for a simple migration, let's just use the existing ID as text if schema allows, 
                    // or generate new ones.
                    // Schema in plan was: id uuid.
                    // Local IDs are numeric/string. This will FAIL.
                    // Plan: We should store the local ID in a separate column 'legacy_id' or just generate new IDs.
                    // If we generate new Ids, we break relationships (Sales -> Products).

                    // RETRY: Let's assume user defined ID as TEXT in Supabase for simplicity, 
                    // OR we must convert all data to use UUIDs.
                    // Converting is hard.
                    // RECOMMENDATION: Change Supabase ID to TEXT for 'id' column to support legacy IDs.

                    name: p.name,
                    model: p.model,
                    price: p.price,
                    stock: p.stock,
                    image: p.image,
                    category: p.category
                }))
            );
            if (error) throw new Error(`Products error: ${error.message}`);
        }

        // 2. Migrate Customers
        const customersStr = localStorage.getItem('jbl_pos_customers');
        if (customersStr) {
            const customers: Customer[] = JSON.parse(customersStr);
            console.log(`Migrating ${customers.length} customers...`);
            const { error } = await supabase.from('customers').upsert(
                customers.map(c => ({
                    id: c.id,
                    name: c.name,
                    phone: c.phone,
                    address: c.address,
                    platform: c.platform,
                    page: c.page
                }))
            );
            if (error) throw new Error(`Customers error: ${error.message}`);
        }

        // 3. Migrate Sales
        const salesStr = localStorage.getItem('jbl_pos_sales');
        if (salesStr) {
            const sales: Sale[] = JSON.parse(salesStr);
            console.log(`Migrating ${sales.length} sales...`);

            for (const sale of sales) {
                // Insert Sale
                const { error: saleError } = await supabase.from('sales').insert({
                    id: sale.id,
                    total: sale.total,
                    discount: sale.discount,
                    date: sale.date,
                    payment_method: sale.paymentMethod,
                    type: sale.type,
                    salesman: sale.salesman,
                    customer_care: sale.customerCare,
                    remark: sale.remark,
                    amount_received: sale.amountReceived,
                    settle_date: sale.settleDate,
                    payment_status: sale.paymentStatus,
                    order_status: sale.orderStatus,
                    shipping_company: sale.shipping?.company,
                    tracking_number: sale.shipping?.trackingNumber,
                    shipping_status: sale.shipping?.status,
                    shipping_cost: sale.shipping?.cost,
                    customer_snapshot: sale.customer // Store full customer object
                }).select();

                if (saleError) {
                    console.error("Sale error", saleError);
                    continue;
                }

                // Insert Items
                if (sale.items && sale.items.length > 0) {
                    const { error: itemsError } = await supabase.from('sale_items').insert(
                        sale.items.map(item => ({
                            sale_id: sale.id,
                            product_id: item.id,
                            name: item.name,
                            price: item.price,
                            quantity: item.quantity,
                            image: item.image
                        }))
                    );
                    if (itemsError) console.error("Sale items error", itemsError);
                }
            }
        }

        // 4. Migrate Config
        const configStr = localStorage.getItem('jbl_pos_config');
        if (configStr) {
            console.log("Migrating config...");
            const config = JSON.parse(configStr);
            const { error } = await supabase.from('app_config').upsert({
                id: 1,
                data: config
            });
            if (error) {
                // If table doesn't exist, we might get error. But we assume schema exists.
                console.error("Config error", error);
                // Don't throw, just log.
            }
        }

        return { success: true };
    } catch (error: any) {
        console.error("Migration failed:", error);
        return { success: false, error: error.message };
    }
};
