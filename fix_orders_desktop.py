
import os

file_path = r'd:\Documents\Programming\Antigravity\POS\src\pages\Orders.tsx'

with open(file_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

updated = False
for i, line in enumerate(lines):
    # Search for the specific Desktop logic line
    if "if (order.shipping && currentStatus !== 'Pending' && currentStatus !== 'Ordered') {" in line:
        # Verify it's deep in the file (Desktop section) to avoid false positives (though Mobile was already fixed to different logic)
        if i > 1500: 
            # Preserve indentation
            indentation = line[:line.find('if')]
            
            # Update the comment above if it matches
            if i > 0 and "// Auto-set Order Status to Returned" in lines[i-2]: # line 1542 passed to 1540 view
                 lines[i-2] = indentation + "// Auto-set Order Status to Returned ONLY if 'Shipped' or 'Delivered'\n"

            # Update the IF condition
            lines[i] = indentation + "if (order.shipping && (currentStatus === 'Shipped' || currentStatus === 'Delivered')) {\n"
            updated = True
            print(f"Updated line {i+1}")

if updated:
    with open(file_path, 'w', encoding='utf-8') as f:
        f.writelines(lines)
    print("File successfully updated.")
else:
    print("Target line not found.")
