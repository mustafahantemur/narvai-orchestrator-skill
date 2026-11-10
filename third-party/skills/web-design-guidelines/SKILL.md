---
name: web-design-guidelines
description: Review UI code for Web Interface Guidelines compliance. Use when asked to "review my UI", "check accessibility", "audit design", "review UX", or "check my site against best practices".
metadata:
  author: vercel
  version: "1.0.0"
  argument-hint: <file-or-pattern>
---

# Web Interface Guidelines

Review files for compliance with Web Interface Guidelines.

## How It Works

1. Read the guidelines in `guidelines.md` next to this file
2. Read the specified files (or prompt user for files/pattern)
3. Check against all rules in those guidelines
4. Output findings in the terse `file:line` format

## Guidelines Source

`guidelines.md` in this skill folder is a reviewed copy of `vercel-labs/web-interface-guidelines` at commit
`434b7f9` (2026-11-11). Do not fetch the rules from the internet; the copy keeps the review stable.

## Usage

When a user provides a file or pattern argument:
1. Read `guidelines.md` from this skill folder
2. Read the specified files
3. Apply all rules from those guidelines
4. Output findings using the format specified in the guidelines

If no files specified, ask the user which files to review.
