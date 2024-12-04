#!/usr/bin/env python3
"""Helper script to fix Python file indentation using black with fallback."""

import ast
import sys
import json
import traceback
from pathlib import Path
from typing import Optional

print("Debug: Starting fix_indentation script", file=sys.stderr)
print(f"Debug: Python path: {sys.path}", file=sys.stderr)
print(f"Debug: Python version: {sys.version}", file=sys.stderr)

try:
    print("Debug: Attempting to import black...", file=sys.stderr)
    import black
    print(f"Debug: Successfully imported black version {black.__version__}", file=sys.stderr)
except ImportError as e:
    print(f"Debug: Failed to import black: {str(e)}", file=sys.stderr)

def format_with_black(source: str, line_length: int = 88) -> Optional[str]:
    """Try to format code using black."""
    try:
        print("Debug: Attempting to format with black...", file=sys.stderr)
        import black
        mode = black.Mode(
            line_length=line_length,
            string_normalization=True,
            is_pyi=False,
        )
        result = black.format_str(source, mode=mode)
        print("Debug: Black formatting successful", file=sys.stderr)
        return result
    except Exception as e:
        print(f"Debug: Black formatting failed: {str(e)}", file=sys.stderr)
        print(traceback.format_exc(), file=sys.stderr)
        return None

def simple_format(source: str, spaces_per_indent: int = 4) -> str:
    """Fallback formatter for when black fails."""
    print("Debug: Using simple fallback formatter", file=sys.stderr)
    lines = source.splitlines()
    fixed_lines = []
    indent_level = 0
    in_string = False
    string_delimiter = None
    
    for line in lines:
        stripped = line.strip()
        
        # Preserve empty lines
        if not stripped:
            fixed_lines.append('')
            continue
            
        # Preserve comments with original indentation
        if stripped.startswith('#'):
            fixed_lines.append(' ' * (indent_level * spaces_per_indent) + stripped)
            continue
            
        # Handle multiline strings
        if '"""' in line or "'''" in line:
            quote = '"""' if '"""' in line else "'''"
            if not in_string:
                string_delimiter = quote
                in_string = True
            elif quote == string_delimiter:
                in_string = False
                
        if in_string:
            fixed_lines.append(line)  # Preserve string formatting
            continue
            
        # Handle basic indentation
        if stripped.startswith(('class ', 'def ')):
            indent_level = 0 if stripped.startswith('class ') else 1
        elif stripped.startswith(('return', 'break', 'continue', 'raise', 'pass')):
            indent_level = max(0, indent_level - 1)
        elif stripped.startswith(('elif ', 'else:', 'except', 'finally:')):
            indent_level = max(0, indent_level - 1)
            
        # Add the line with proper indentation
        fixed_lines.append(' ' * (indent_level * spaces_per_indent) + stripped)
        
        # Adjust indentation for next line
        if stripped.endswith(':'):
            indent_level += 1
            
    return '\n'.join(fixed_lines) + '\n'

def fix_indentation(file_path: str, spaces_per_indent: int = 4, line_length: int = 88) -> None:
    """Fix indentation in a Python file, using black when possible."""
    print(f"Debug: Starting to fix indentation for {file_path}", file=sys.stderr)
    
    # Read the source
    source = Path(file_path).read_text()
    
    # First try with black
    formatted = format_with_black(source, line_length)
    
    if formatted is not None:
        # Black succeeded
        Path(file_path).write_text(formatted)
        print(f"Debug: Successfully formatted {file_path} with black", file=sys.stderr)
    else:
        # Black failed, use simple formatter
        formatted = simple_format(source, spaces_per_indent)
        Path(file_path).write_text(formatted)
        print(f"Debug: Used fallback formatter for {file_path}", file=sys.stderr)

if __name__ == "__main__":
    print("Debug: Script started with args:", sys.argv, file=sys.stderr)
    args = json.loads(sys.argv[1])
    fix_indentation(
        args['file_path'],
        args.get('spaces_per_indent', 4),
        args.get('line_length', 88)
    )