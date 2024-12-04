#!/usr/bin/env python3
"""Helper script to move a method between classes/files using ast."""

import ast
import sys
import json
from pathlib import Path

def move_method(
    source_file: str,
    target_file: str,
    method_name: str,
    source_class: str,
    target_class: str
) -> None:
    """Move a method from one class to another, possibly between files."""
    # Read source file
    source_content = Path(source_file).read_text()
    source_tree = ast.parse(source_content)
    
    # Find and extract the method
    method_node = None
    source_class_node = None
    
    for node in ast.walk(source_tree):
        if isinstance(node, ast.ClassDef) and node.name == source_class:
            source_class_node = node
            for item in node.body:
                if isinstance(item, ast.FunctionDef) and item.name == method_name:
                    method_node = item
                    break
            break
    
    if not method_node:
        raise ValueError(f"Method {method_name} not found in class {source_class}")
        
    # Remove method from source class
    source_class_node.body.remove(method_node)
    
    # If moving to same file
    if source_file == target_file:
        target_tree = source_tree
    else:
        # Read target file
        target_content = Path(target_file).read_text()
        target_tree = ast.parse(target_content)
    
    # Find target class and add method
    for node in ast.walk(target_tree):
        if isinstance(node, ast.ClassDef) and node.name == target_class:
            # Add a blank line for spacing
            if node.body:
                node.body.append(ast.Expr(value=ast.Constant(value='')))
            node.body.append(method_node)
            break
    else:
        raise ValueError(f"Target class {target_class} not found")
    
    # Write back the modified files
    Path(source_file).write_text(ast.unparse(source_tree))
    if source_file != target_file:
        Path(target_file).write_text(ast.unparse(target_tree))

if __name__ == "__main__":
    args = json.loads(sys.argv[1])
    move_method(
        args['source_file'],
        args['target_file'],
        args['method_name'],
        args['source_class'],
        args['target_class']
    )