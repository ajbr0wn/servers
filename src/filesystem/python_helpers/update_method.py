#!/usr/bin/env python3
"""Helper script to update a method body using ast."""

import ast
import sys
import json
from pathlib import Path

def update_method(file_path: str, method_name: str, new_body: str) -> None:
    """Update a method's body while preserving its signature."""
    # Read and parse the file
    source = Path(file_path).read_text()
    tree = ast.parse(source)
    
    # Parse the new body
    # We wrap it in a dummy function to parse it
    dummy_func = ast.parse(f"def dummy():\n{new_body}").body[0]
    new_body_nodes = dummy_func.body
    
    # Find and update the target method
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == method_name:
            # Preserve the original method signature
            node.body = new_body_nodes
            break
    
    # Write back the modified code
    Path(file_path).write_text(ast.unparse(tree))

if __name__ == "__main__":
    args = json.loads(sys.argv[1])
    update_method(
        args['file_path'],
        args['method_name'],
        args['new_body']
    )