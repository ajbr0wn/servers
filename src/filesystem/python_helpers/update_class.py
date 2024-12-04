#!/usr/bin/env python3
"""Helper script to update a class definition using ast."""

import ast
import sys
import json
from pathlib import Path

def update_class(file_path: str, class_name: str, new_class_def: str) -> None:
    """Update a class with new implementation while preserving surrounding code."""
    # Read and parse the file
    source = Path(file_path).read_text()
    tree = ast.parse(source)
    
    # Parse the new class
    new_class = ast.parse(new_class_def).body[0]
    if not isinstance(new_class, ast.ClassDef):
        raise ValueError("new_class_def must define a class")
        
    # Preserve the original class name
    new_class.name = class_name
    
    # Find and replace the class
    for i, node in enumerate(tree.body):
        if isinstance(node, ast.ClassDef) and node.name == class_name:
            tree.body[i] = new_class
            break
    else:
        raise ValueError(f"Class {class_name} not found")
    
    # Write back the modified code
    Path(file_path).write_text(ast.unparse(tree))

if __name__ == "__main__":
    args = json.loads(sys.argv[1])
    update_class(
        args['file_path'],
        args['class_name'],
        args['new_class_def']
    )