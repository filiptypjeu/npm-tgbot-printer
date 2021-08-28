#!/bin/bash

echo "Installing dependencies..."
npm install --only=production
echo "Installation complete!"

echo "Building..."
npm run build
echo "Building done!"
