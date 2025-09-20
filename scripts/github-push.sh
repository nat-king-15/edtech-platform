#!/bin/bash

# GitHub Push Script for EdTech Platform
# This script helps push the project to GitHub

set -e

echo "🚀 EdTech Platform - GitHub Push Helper"
echo "========================================"

# Check if git is installed
if ! command -v git &> /dev/null; then
    echo "❌ Git is not installed. Please install Git first."
    exit 1
fi

# Check current git status
echo "📊 Current Git Status:"
git status
echo ""

# Check if remote already exists
if git remote | grep -q "origin"; then
    echo "🔗 Remote 'origin' already exists:"
    git remote -v
    echo ""
    
    echo "🔄 Pushing to existing remote..."
    git push -u origin main
    echo "✅ Push completed!"
else
    echo "❌ No remote repository configured."
    echo ""
    echo "📝 Please follow these steps:"
    echo "1. Go to https://github.com/new"
    echo "2. Create a new repository named 'edtech-platform'"
    echo "3. Don't initialize with README (you already have code)"
    echo "4. Copy the repository URL"
    echo "5. Run: git remote add origin YOUR_REPOSITORY_URL"
    echo "6. Then run: git push -u origin main"
    echo ""
    
    read -p "Press Enter when you've created the repository and want to continue..."
    
    # Check again if remote was added
    if git remote | grep -q "origin"; then
        echo "🔄 Pushing to GitHub..."
        git push -u origin main
        echo "✅ Push completed!"
    else
        echo "❌ Remote still not configured. Please add the remote manually."
    fi
fi

echo ""
echo "🎉 GitHub push process completed!"
echo "🔗 Your repository should now be available on GitHub."