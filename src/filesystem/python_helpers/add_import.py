#!/usr/bin/env python3
"""Helper script to add imports using ast."""

import ast
import sys
import json
from pathlib import Path

def add_imports(file_path: str, imports: list[str]) -> None:
    """Add imports to the top of the file, after any existing imports."""
    # Read and parse the file
    source = Path(file_path).read_text()
    tree = ast.parse(source)
    
    # Parse the new imports
    new_import_nodes = []
    for imp in imports:
        new_import_nodes.extend(ast.parse(imp).body)
    
    # Find where to insert the imports
    last_import_idx = -1
    for i, node in enumerate(tree.body):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            last_import_idx = i
    
    # Insert after the last import, or at the start if no imports
    insert_idx = last_import_idx + 1 if last_import_idx >= 0 else 0
    
    # Add a newline after imports if inserting before code
    if insert_idx < len(tree.body):
        tree.body[insert_idx:insert_idx] = new_import_nodes + [ast.Expr(value=ast.Constant(value=''))]
    else:
        tree.body[insert_idx:insert_idx] = new_import_nodes
    
    # Write back the modified code
    Path(file_path).write_text(ast.unparse(tree))

if __name__ == "__main__":
    args = json.loads(sys.argv[1])
    add_imports(
        args['file_path'],
        args['imports']
    )