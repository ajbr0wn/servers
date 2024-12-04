#!/usr/bin/env python3
"""Helper script to move code between files while updating references."""

import ast
import sys
import json
from pathlib import Path
from typing import List, Set

def collect_names(node: ast.AST) -> Set[str]:
    """Collect all names used in an AST node."""
    names = set()
    for child in ast.walk(node):
        if isinstance(child, ast.Name):
            names.add(child.id)
    return names

def find_required_imports(node: ast.AST, current_imports: List[ast.Import]) -> Set[str]:
    """Find imports needed by the code being moved."""
    used_names = collect_names(node)
    needed_imports = set()
    
    for imp in current_imports:
        if isinstance(imp, ast.Import):
            for alias in imp.names:
                if alias.asname:
                    if alias.asname in used_names:
                        needed_imports.add(ast.unparse(imp))
                elif alias.name in used_names:
                    needed_imports.add(ast.unparse(imp))
        elif isinstance(imp, ast.ImportFrom):
            for alias in imp.names:
                if alias.asname:
                    if alias.asname in used_names:
                        needed_imports.add(ast.unparse(imp))
                elif alias.name in used_names:
                    needed_imports.add(ast.unparse(imp))
    
    return needed_imports

def move_code(
    source_file: str,
    target_file: str,
    start_line: int,
    end_line: int,
    target_line: int,
    move_imports: bool = True
) -> None:
    """Move a block of code from one file to another."""
    # Read source file
    source_content = Path(source_file).read_text()
    source_lines = source_content.splitlines()
    
    # Extract the code block
    code_block = '\n'.join(source_lines[start_line-1:end_line])
    remaining_code = '\n'.join(source_lines[:start_line-1] + source_lines[end_line:])
    
    # Parse both for AST analysis
    source_tree = ast.parse(source_content)
    code_block_tree = ast.parse(code_block)
    
    # If requested, find required imports
    needed_imports = set()
    if move_imports:
        imports = [n for n in source_tree.body if isinstance(n, (ast.Import, ast.ImportFrom))]
        needed_imports = find_required_imports(code_block_tree, imports)
    
    # Read target file
    target_content = Path(target_file).read_text()
    target_lines = target_content.splitlines()
    
    # Insert code at target location
    if move_imports and needed_imports:
        # Find last import in target file
        last_import_line = 0
        target_tree = ast.parse(target_content)
        for i, node in enumerate(target_tree.body):
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                last_import_line = i + 1
        
        # Insert required imports after last import
        target_lines = (
            target_lines[:last_import_line] +
            list(needed_imports) +
            [''] +  # Blank line after imports
            target_lines[last_import_line:]
        )
    
    # Insert the moved code
    target_lines = (
        target_lines[:target_line-1] +
        code_block.splitlines() +
        [''] +  # Blank line after inserted code
        target_lines[target_line-1:]
    )
    
    # Write back both files
    Path(source_file).write_text(remaining_code)
    Path(target_file).write_text('\n'.join(target_lines))

if __name__ == "__main__":
    args = json.loads(sys.argv[1])
    move_code(
        args['source_file'],
        args['target_file'],
        args['start_line'],
        args['end_line'],
        args['target_line'],
        args.get('move_imports', True)
    )