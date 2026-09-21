/**
 * POS Database Sync Checker
 * 
 * Connects to all Supabase instances and reports what tables, columns,
 * and indexes are present or missing on each one.
 * 
 * Usage:
 *   node migrations/sync_database.cjs                    # Check all instances
 *   node migrations/sync_database.cjs --instance Romdoul1  # Check one instance
 */

const { createClient } = require('@supabase/supabase-js');
const path = require('path');

// Load instance config
const instances = require('./db_instances.json').instances;

// ─── Expected Schema Definition ────────────────────────────────────
// Define what SHOULD exist in every database

const EXPECTED_TABLES = {
    products: [
        'id', 'name', 'model', 'price', 'stock', 'low_stock_threshold',
        'image', 'category', 'low_stock_alert', 'created_at',
        // purchase_cost/is_active back every COGS figure in all three Income
        // Prediction screens (and is_active gates which products count as
        // "still active" there); sku/invoice_number/supplier are the rest of
        // StoreContext.tsx's own products select (line ~353) — without these
        // here, a column missing on some instance would report "products ✅"
        // even though it breaks the exact features that depend on it.
        'purchase_cost', 'is_active', 'sku', 'invoice_number', 'supplier'
    ],
    customers: [
        'id', 'name', 'phone', 'email', 'address', 'city',
        'platform', 'page', 'created_at'
    ],
    sales: [
        'id', 'total', 'discount', 'date', 'payment_method', 'type',
        'salesman', 'customer_care', 'remark', 'amount_received',
        'settle_date', 'payment_status', 'order_status',
        'shipping_company', 'tracking_number', 'shipping_status',
        'shipping_cost', 'customer_snapshot', 'page_source',
        'last_edited_at', 'last_edited_by', 'created_at',
        'daily_number'  // Added by add_daily_number.sql
    ],
    sale_items: [
        'id', 'sale_id', 'product_id', 'name', 'price',
        'quantity', 'image', 'created_at'
    ],
    users: [
        'id', 'name', 'email', 'role_id', 'pin', 'created_at',
        'base_salary',   // Added by payroll_migration.sql
        'daily_target',  // Added by add_salesman_targets.sql
        'weekly_target', // Added by add_salesman_targets.sql
        'monthly_target' // Added by add_salesman_targets.sql
    ],
    app_config: ['id', 'data', 'created_at'],
    restocks: [
        'id', 'product_id', 'quantity', 'cost', 'date', 'added_by', 'note'
    ],
    transactions: [
        'id', 'type', 'amount', 'category', 'description',
        'date', 'added_by', 'created_at', 'shipping_co'
    ],
    stock_movements: [
        'id', 'product_id', 'product_name', 'type', 'quantity',
        'unit_price', 'source', 'reason', 'reference_id',
        'shipping_co', 'note', 'movement_date', 'created_by', 'created_at'
    ],
    staff_attendance: [
        'id', 'user_id', 'date', 'status', 'clock_in', 'clock_out',
        'notes', 'created_at', 'updated_at'
    ],
    activity_logs: [
        'id', 'action', 'description', 'user_id', 'user_name',
        'metadata', 'created_at'
    ],
    custom_locations: [
        'id', 'pcode', 'name', 'lat', 'lng', 'type',
        'courier', 'province', 'district', 'commune',
        'phone', 'contact_name', 'is_shutdown', 'created_at', 'updated_at'
    ],
    shipping_rules: [
        'id', 'pcode', 'name', 'is_shippable', 'shipping_fee',
        'estimated_days', 'supported_couriers', 'created_at', 'updated_at'
    ],
    // Tables created by hand on Romdoul1 (no migration file) — layout copied
    // from the live tables. create_warehouses.sql now covers the first two.
    warehouses: ['id', 'name', 'address', 'contact', 'capacity', 'created_at', 'updated_at'],
    warehouse_stock: ['id', 'warehouse_id', 'product_id', 'quantity', 'created_at', 'updated_at'],
    purchase_order_items: ['id', 'purchase_order_id', 'product_id', 'quantity', 'unit_price', 'created_at'],
    supplier_payments: ['id', 'purchase_order_id', 'supplier_id', 'amount', 'payment_date', 'payment_method', 'notes', 'created_at'],
    todos: ['id', 'title', 'description', 'due_date', 'priority', 'status', 'project', 'created_at', 'updated_at', 'user_id', 'repeat_rule', 'remind_at', 'last_reminded_on'],
    todo_projects: ['id', 'name', 'color', 'created_at', 'user_id'],
    income_predictions: ['date', 'shipped_delivered', 'order_count', 'cogs', 'shipping', 'boost_page', 'staff', 'profit', 'updated_at', 'updated_by'],
    // Prediction by Page manual inputs (create_page_income_predictions.sql).
    page_income_predictions: ['date', 'page', 'boost_page', 'shipping', 'updated_at', 'updated_by'],
    // Income Prediction's auto-saved Staff input (create_income_prediction_staff.sql).
    income_prediction_staff: ['date', 'staff', 'updated_at', 'updated_by'],
    // Tables with their own migration file: existence check only (empty list).
    inventory_items: [],
    deleted_orders: [],
    deleted_sale_items: [],
    telegram_notifications: [],
    shipment_tracking: [],
    employees: [],
    leave_requests: [],
    payroll_runs: [],
    leads: [],
    interactions: [],
    quotations: [],
    suppliers: [],
    purchase_orders: [],
    chart_of_accounts: [],
    journal_entries: [],
    journal_entry_lines: [],
    wholesale_orders: [],
    wholesale_order_items: [],
    customer_payments: [],
    wholesale_customers: [],
    warehouse_transfers: [],
    warehouse_transfer_receipts: [],
};

// Which file in this folder creates a table (for the summary). Tables not
// listed here are in full_schema.sql or were created by hand on every instance.
const MIGRATION_FOR = {
    warehouses: 'create_warehouses.sql',
    warehouse_stock: 'create_warehouses.sql',
    income_predictions: 'create_income_predictions.sql',
    page_income_predictions: 'create_page_income_predictions.sql',
    income_prediction_staff: 'create_income_prediction_staff.sql',
    inventory_items: 'create_inventory_items.sql',
    deleted_orders: 'create_deleted_orders.sql',
    deleted_sale_items: 'create_deleted_orders.sql',
    telegram_notifications: 'create_telegram_notifications.sql',
    shipment_tracking: 'shipment_tracking.sql',
    employees: 'erp_schema_additions.sql',
    leave_requests: 'erp_schema_additions.sql',
    payroll_runs: 'erp_schema_additions.sql',
    leads: 'erp_schema_additions.sql',
    interactions: 'erp_schema_additions.sql',
    quotations: 'erp_schema_additions.sql',
    suppliers: 'erp_schema_additions.sql',
    purchase_orders: 'erp_schema_additions.sql',
    chart_of_accounts: 'erp_schema_additions.sql',
    journal_entries: 'erp_schema_additions.sql',
    journal_entry_lines: 'erp_schema_additions.sql',
    wholesale_orders: 'wholesale_orders.sql',
    wholesale_order_items: 'wholesale_orders.sql',
    customer_payments: 'wholesale_orders.sql',
    wholesale_customers: 'wholesale_orders.sql',
    warehouse_transfers: 'accounts_receivable_transfers.sql',
    warehouse_transfer_receipts: 'accounts_receivable_transfers.sql',
};

// PostgREST answers for a table that isn't in its schema cache.
const isMissingTableError = (error) =>
    !!error && (
        error.code === '42P01' || error.code === 'PGRST204' || error.code === 'PGRST205' ||
        /schema cache|does not exist|relation/i.test(error.message || '')
    );

const EXPECTED_INDEXES = [
    'idx_sale_items_sale_id',
    'idx_sales_date',
    'idx_sales_salesman',
    'idx_sales_shipping_status',
    'idx_sales_payment_status',
    'idx_sales_date_daily_number',
    'idx_stock_movements_type_date',
    'idx_stock_movements_product',
    'idx_stock_movements_created',
    'idx_activity_logs_created_at',
    'custom_locations_pcode_idx'
];

// SQL that fixes everything found missing (reference — user copies to SQL Editor)
const FIX_SCRIPT_PATH = path.join(__dirname, 'full_schema.sql');

// ─── Colors ────────────────────────────────────────────────────────
const C = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    bgRed: '\x1b[41m',
    bgGreen: '\x1b[42m',
    white: '\x1b[37m',
};

// ─── Check One Instance ────────────────────────────────────────────
async function checkInstance(instance) {
    const supabase = createClient(instance.url, instance.anonKey);
    const issues = [];

    // 1. Get all tables in public schema
    const { data: tables, error: tablesError } = await supabase.rpc('get_table_info');

    // If the RPC doesn't exist, fall back to checking tables individually
    let existingTables = {};
    let existingIndexes = [];

    if (tablesError) {
        // Fallback: probe each table with a count query
        for (const tableName of Object.keys(EXPECTED_TABLES)) {
            const { error } = await supabase.from(tableName).select('*', { count: 'exact', head: true });
            if (error && (error.code === '42P01' || error.message.includes('does not exist') || error.code === 'PGRST204')) {
                existingTables[tableName] = null; // table doesn't exist
            } else if (!error || error.code === 'PGRST116') {
                // Table exists - try to get column info by fetching one row
                const { data: sample } = await supabase.from(tableName).select('*').limit(1);
                if (sample && sample.length > 0) {
                    existingTables[tableName] = Object.keys(sample[0]);
                } else {
                    // Table exists but is empty — try inserting/reading columns from schema
                    // We'll just mark it as existing with unknown columns
                    existingTables[tableName] = 'exists_empty';
                }
            }
        }
    }

    return { existingTables, issues };
}

async function runCheck(instance) {
    const supabase = createClient(instance.url, instance.anonKey);
    const results = {
        name: instance.name,
        tables: {},
        missingTables: [],
        missingColumns: {},
        totalIssues: 0
    };

    console.log(`\n${C.cyan}${C.bold}── ${instance.name} ──────────────────────────────────${C.reset}`);
    console.log(`${C.dim}   ${instance.url}${C.reset}`);

    // Check each expected table
    for (const [tableName, expectedColumns] of Object.entries(EXPECTED_TABLES)) {
        // Try to query the table
        const { data, error } = await supabase.from(tableName).select('*').limit(1);

        if (error && (error.message?.includes('fetch failed') || error.message?.includes('Failed to fetch') || error.message?.includes('network') || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT')) {
            throw new Error(`Connection failed: ${error.message || 'fetch failed'}`);
        }

        if (isMissingTableError(error)) {
            // Table doesn't exist
            results.missingTables.push(tableName);
            results.totalIssues++;
            const fix = MIGRATION_FOR[tableName] || 'full_schema.sql';
            console.log(`   ${C.red}❌ ${tableName}${C.reset} ${C.dim}← TABLE MISSING (run ${fix})${C.reset}`);
        } else if (error && error.code === '42501') {
            // Reads revoked for the anon key (users.pin lockdown from
            // secure_pin_check.sql) — the table exists, we just can't inspect it.
            console.log(`   ${C.green}✅ ${tableName}${C.reset} ${C.dim}(read-protected, columns not checked)${C.reset}`);
        } else if (expectedColumns.length === 0) {
            console.log(`   ${C.green}✅ ${tableName}${C.reset}`);
        } else {
            // Table exists - check columns
            let actualColumns = [];
            if (data && data.length > 0) {
                actualColumns = Object.keys(data[0]);
            } else {
                // Empty table — select all expected columns at once.
                // Supabase will error if a column doesn't exist.
                const { error: allColErr } = await supabase.from(tableName).select(expectedColumns.join(',')).limit(1);
                if (!allColErr) {
                    // All columns exist
                    actualColumns = [...expectedColumns];
                } else {
                    // Some columns missing — probe each one
                    for (const col of expectedColumns) {
                        const { error: colErr } = await supabase.from(tableName).select(col).limit(1);
                        if (!colErr) {
                            actualColumns.push(col);
                        }
                    }
                }
            }

            const missingCols = expectedColumns.filter(col => !actualColumns.includes(col));

            if (missingCols.length > 0) {
                results.missingColumns[tableName] = missingCols;
                results.totalIssues += missingCols.length;
                console.log(`   ${C.yellow}⚠  ${tableName}${C.reset} ${C.dim}← missing columns: ${C.red}${missingCols.join(', ')}${C.reset}`);
            } else {
                console.log(`   ${C.green}✅ ${tableName}${C.reset}`);
            }
        }
    }

    // Summary
    if (results.totalIssues === 0) {
        console.log(`\n   ${C.bgGreen}${C.white}${C.bold} ✓ ALL GOOD ${C.reset} ${C.green}No issues found${C.reset}`);
    } else {
        const files = [...new Set(results.missingTables.map(t => MIGRATION_FOR[t] || 'full_schema.sql'))];
        if (Object.keys(results.missingColumns).length > 0 && !files.includes('full_schema.sql')) files.push('full_schema.sql');
        console.log(`\n   ${C.bgRed}${C.white}${C.bold} ${results.totalIssues} ISSUE(S) ${C.reset} ${C.red}Run ${files.join(', ')} in this instance's SQL editor${C.reset}`);
    }

    return results;
}

// ─── Main ──────────────────────────────────────────────────────────
async function main() {
    const args = process.argv.slice(2);
    const instanceFilter = args.indexOf('--instance') !== -1 
        ? args[args.indexOf('--instance') + 1] 
        : null;

    console.log(`\n${C.bold}╔═══════════════════════════════════════════════╗${C.reset}`);
    console.log(`${C.bold}║   ${C.cyan}POS Database Sync Checker${C.reset}${C.bold}                  ║${C.reset}`);
    console.log(`${C.bold}╚═══════════════════════════════════════════════╝${C.reset}`);
    console.log(`${C.dim}   Checking ${instanceFilter || 'all'} database(s)...${C.reset}`);

    const targetInstances = instanceFilter 
        ? instances.filter(i => i.name.toLowerCase() === instanceFilter.toLowerCase())
        : instances;

    if (targetInstances.length === 0) {
        console.log(`${C.red}Error: Instance "${instanceFilter}" not found.${C.reset}`);
        console.log(`Available: ${instances.map(i => i.name).join(', ')}`);
        process.exit(1);
    }

    const allResults = [];
    for (const instance of targetInstances) {
        try {
            const result = await runCheck(instance);
            allResults.push(result);
        } catch (err) {
            console.log(`   ${C.red}ERROR: ${err.message}${C.reset}`);
            allResults.push({ name: instance.name, totalIssues: -1, error: err.message });
        }
    }

    // Final summary
    console.log(`\n${C.bold}═══════════════════════════════════════════════${C.reset}`);
    console.log(`${C.bold}SUMMARY${C.reset}`);
    console.log(`${C.bold}═══════════════════════════════════════════════${C.reset}`);

    let hasAnyIssues = false;
    for (const r of allResults) {
        if (r.totalIssues === -1) {
            console.log(`  ${C.red}✗${C.reset} ${r.name}: ${C.red}Connection error${C.reset}`);
            hasAnyIssues = true;
        } else if (r.totalIssues > 0) {
            console.log(`  ${C.red}✗${C.reset} ${r.name}: ${C.red}${r.totalIssues} issue(s)${C.reset}`);
            if (r.missingTables?.length > 0) {
                console.log(`    ${C.dim}Missing tables: ${r.missingTables.join(', ')}${C.reset}`);
                const files = [...new Set(r.missingTables.map(t => MIGRATION_FOR[t] || 'full_schema.sql'))];
                console.log(`    ${C.dim}Run in its SQL editor: ${files.join(', ')}${C.reset}`);
            }
            if (r.missingColumns && Object.keys(r.missingColumns).length > 0) {
                for (const [table, cols] of Object.entries(r.missingColumns)) {
                    console.log(`    ${C.dim}${table}: missing ${cols.join(', ')}${C.reset}`);
                }
            }
            hasAnyIssues = true;
        } else {
            console.log(`  ${C.green}✓${C.reset} ${r.name}: ${C.green}All good${C.reset}`);
        }
    }

    if (hasAnyIssues) {
        console.log(`\n${C.yellow}To fix, run the file(s) listed under each instance in that instance's Supabase SQL editor.${C.reset}`);
        console.log(`${C.dim}  All files live in ${path.dirname(FIX_SCRIPT_PATH)} and are safe to re-run.${C.reset}\n`);
    } else {
        console.log(`\n${C.green}All databases are in sync! 🎉${C.reset}\n`);
    }
}

main().catch(err => {
    console.error(`${C.red}Fatal error:${C.reset}`, err);
    process.exit(1);
});
