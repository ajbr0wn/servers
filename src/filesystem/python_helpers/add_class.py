#!/usr/bin/env python3
"""Helper script to add a class definition using ast."""

import ast
import sys
import json
from pathlib import Path

def add_class(file_path: str, class_def: str, after_class: str = None) -> None:
    """Add a class to a Python file.
    
    Args:
        file_path: Path to the Python file
        class_def: Complete class definition as string
        after_class: Optional class name to insert after
    """
    # Read and parse the file
    source = Path(file_path).read_text()
    tree = ast.parse(source)
    
    # Parse the new class
    new_class = ast.parse(class_def).body[0]
    
    # Find insertion point
    if after_class:
        for i, node in enumerate(tree.body):
            if isinstance(node, ast.ClassDef) and node.name == after_class:
                tree.body.insert(i + 1, new_class)
                break
        else:
            raise ValueError(f"Class {after_class} not found")
    else:
        # Add to end of file with proper spacing
        if tree.body:
            tree.body.append(ast.Expr(value=ast.Constant(value='')))  # Add blank line
        tree.body.append(new_class)
    
    # Write back the modified code
    Path(file_path).write_text(ast.unparse(tree))

if __name__ == "__main__":
    args = json.loads(sys.argv[1])
    add_class(
        args['file_path'],
        args['class_def'],
        args.get('after_class')
    )