
import os

file_path = r'd:\Documents\Programming\Antigravity\POS\src\pages\Orders.tsx'

with open(file_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()
    # Print lines around 1530-1550 (0-indexed: 1529-1549)
    start = 1535
    end = 1555
    for i, line in enumerate(lines[start:end]):
        print(f"{start+i+1}: {repr(line)}")
