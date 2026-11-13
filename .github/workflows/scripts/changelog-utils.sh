#!/usr/bin/env bash
source "$(dirname "$0")/semver.sh"

# Function to extract content from a file
# Usage: get_file_content <file_path>
# Returns the file content with comments removed, or empty string if file doesn't exist
get_file_content() {
    if [ -f "$1" ]; then
        content=$(cat "$1")
        # Skip comments from content
        content=$(echo "$content" | grep -v '^<!--' | grep -v '^-->')
        # Version files are read with the strict reader: exactly one trailing
        # line ending, no internal whitespace, bare SemVer output.
        if [[ "$1" == *"/version" ]]; then
            content=$(read_semver_file "$1")
        fi
        echo "$content"
    else
        echo ""
    fi
}