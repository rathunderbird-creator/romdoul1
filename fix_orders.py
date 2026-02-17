
import os

file_path = r'd:\Documents\Programming\Antigravity\POS\src\pages\Orders.tsx'

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

target = "if (order.shipping && order.shipping.status !== 'Pending' && order.shipping.status !== 'Ordered') {"
replacement = "const currentStatus = order.shipping?.status || 'Pending'; if (order.shipping && currentStatus !== 'Pending' && currentStatus !== 'Ordered') {"

if target in content:
    new_content = content.replace(target, replacement)
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(new_content)
    print("Successfully replaced content.")
else:
    print("Target content not found.")
