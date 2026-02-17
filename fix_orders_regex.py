
import os
import re

file_path = r'd:\Documents\Programming\Antigravity\POS\src\pages\Orders.tsx'

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Pattern to find the Desktop cancellation block.
# We look for the second occurrence of "else if (newStatus === 'Cancel')" or distinct context.
# The Desktop one is inside specific columns loop? No, it's inside `PaymentStatusBadge` which is inside `case 'payStatus':`.

# Let's find the block by surrounding context.
# We know Desktop has: case 'payStatus': ... <PaymentStatusBadge ... 
# And then onChange ... 

# We will look for the specific lines we saw in view_file and replace them using regex to be flexible with whitespace.

# The target is the IF block inside Cancel.
# We want to replace:
# if (order.shipping && order.shipping.status !== 'Pending' && order.shipping.status !== 'Ordered') {
#    updates.shipping = { ...order.shipping, status: 'Returned' };
# }

# with:
# const currentStatus = order.shipping?.status || 'Pending';
# if (order.shipping && currentStatus !== 'Pending' && currentStatus !== 'Ordered') {
#    updates.shipping = { ...order.shipping, status: 'Returned' };
# }

# matches both simple and complex if they exist.

# Regex to match the IF block, handling variable whitespace
pattern = r"if\s*\(\s*order\.shipping\s*&&\s*order\.shipping\.status\s*!==\s*'Pending'(\s*&&\s*order\.shipping\.status\s*!==\s*'Ordered')?\s*\)\s*\{\s*updates\.shipping\s*=\s*\{\s*\.\.\.order\.shipping,\s*status:\s*'Returned'\s*\}\s*;\s*\}"

replacement = "const currentStatus = order.shipping?.status || 'Pending'; if (order.shipping && currentStatus !== 'Pending' && currentStatus !== 'Ordered') { updates.shipping = { ...order.shipping, status: 'Returned' }; }"

# We expect this to match TWICE (once for Mobile, once for Desktop) if I didn't already fix Mobile differently.
# Attempt to replace all occurrences.

new_content, count = re.subn(pattern, replacement, content)

print(f"Replaced {count} occurrences.")

if count > 0:
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(new_content)
    print("File updated.")
else:
    # If regex failed, it might be because I already modified Mobile to use 'const currentStatus ...'
    # So I should also search for the 'old' desktop pattern specifically:
    # if (order.shipping && order.shipping.status !== 'Pending') { ... } 
    # OR 
    # if (order.shipping && order.shipping.status !== 'Pending' && order.shipping.status !== 'Ordered') { ... }
    
    # Let's try to match the case where it might be the old code or the new code but without the const
    print("Regex didn't match. Dumping snippet around 1542 for manual check.")
    lines = content.splitlines()
    if len(lines) > 1540:
        for i in range(1535, 1550):
            print(f"{i+1}: {lines[i]}")

