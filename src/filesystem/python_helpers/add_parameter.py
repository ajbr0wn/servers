#!/usr/bin/env python3
"""Helper script to add a parameter to a method using ast."""

import ast
import sys
import json
from pathlib import Path

def add_parameter(file_path: str, method_name: str, param_name: str, param_type: str = None, default_value: str = None) -> None:
    """Add a parameter to a method's signature."""
    # Read and parse the file
    source = Path(file_path).read_text()
    tree = ast.parse(source)
    
    # Find the target method
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == method_name:
            # Create the new parameter
            new_param = ast.arg(arg=param_name)
            if param_type:
                # Add type annotation if provided
                new_param.annotation = ast.parse(param_type).body[0].value
            
            # Add the parameter to args
            node.args.args.append(new_param)
            
            # Add default value if provided
            if default_value:
                default_node = ast.parse(default_value).body[0].value
                node.args.defaults.append(default_node)
            elif len(node.args.defaults) < len(node.args.args):
                # No default provided, but we have some defaults
                # Need to ensure defaults list matches args
                node.args.defaults.insert(0, None)
                
            break
    
    # Write back the modified code
    Path(file_path).write_text(ast.unparse(tree))

if __name__ == "__main__":
    args = json.loads(sys.argv[1])
    add_parameter(
        args['file_path'],
        args['method_name'],
        args['param_name'],
        args.get('param_type'),
        args.get('default_value')
    )