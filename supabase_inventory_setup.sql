-- 1. View for products with aggregated sales stats
CREATE OR REPLACE VIEW product_inventory_stats AS
SELECT 
    p.id,
    p.name,
    p.model,
    p.price,
    p.stock,
    p.low_stock_threshold,
    p.image,
    p.category,
    p.created_at,
    (p.price * p.stock) as "totalValue",
    COALESCE(
        (SELECT SUM(si.quantity) 
         FROM sale_items si 
         JOIN sales s ON s.id = si.sale_id 
         WHERE si.product_id = p.id 
         AND s.payment_status IN ('Paid', 'Settled', 'Paid/Settled')
        ), 0
    ) as "soldPaid"
FROM products p;

