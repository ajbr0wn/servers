#!/usr/bin/env python3
"""Helper script to add a method to a Python class using ast."""

import ast
import sys
import json
from pathlib import Path

def add_method(file_path: str, class_name: str, method_content: str, after_method: str = None) -> None:
    """Add a method to a class."""
    # Read the file
    source = Path(file_path).read_text()
    
    # Parse it into an AST
    tree = ast.parse(source)
    
    # Parse the new method
    method_ast = ast.parse(method_content).body[0]
    
    # Find the target class
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef) and node.name == class_name:
            if after_method:
                # Find the method we want to insert after
                for i, child in enumerate(node.body):
                    if isinstance(child, ast.FunctionDef) and child.name == after_method:
                        node.body.insert(i + 1, method_ast)
                        break
            else:
                # Add to end of class
                node.body.append(method_ast)
            break
    
    # Write back the modified code
    Path(file_path).write_text(ast.unparse(tree))

if __name__ == "__main__":
    # Get arguments as JSON
    args = json.loads(sys.argv[1])
    add_method(
        args['file_path'],
        args['class_name'],
        args['method_content'],
        args.get('after_method')
    )