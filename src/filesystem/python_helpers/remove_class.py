#!/usr/bin/env python3
"""Helper script to remove a class and its contents using ast."""

import ast
import sys
import json
from pathlib import Path

def remove_class(file_path: str, class_name: str) -> None:
    """Remove a class and its contents from a Python file."""
    # Read and parse the file
    source = Path(file_path).read_text()
    tree = ast.parse(source)
    
    # Find and remove the class
    for i, node in enumerate(tree.body):
        if isinstance(node, ast.ClassDef) and node.name == class_name:
            # Remove the class and any preceding comments/docstrings
            while i > 0 and isinstance(tree.body[i-1], ast.Expr) and isinstance(tree.body[i-1].value, ast.Constant):
                i -= 1
            # Remove any trailing newlines
            while i+1 < len(tree.body) and isinstance(tree.body[i+1], ast.Expr) and isinstance(tree.body[i+1].value, ast.Constant):
                tree.body.pop(i+1)
            tree.body.pop(i)
            break
    else:
        raise ValueError(f"Class {class_name} not found")
    
    # Write back the modified code
    Path(file_path).write_text(ast.unparse(tree))

if __name__ == "__main__":
    args = json.loads(sys.argv[1])
    remove_class(
        args['file_path'],
        args['class_name']
    )