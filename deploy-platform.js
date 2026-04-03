#!/usr/bin/env node
const { execSync } = require('child_process');
const path = require('path');

console.log('Deploying platform to VPS...');

execSync('tar -czf platform.tar.gz -C app/src platform', {stdio: 'inherit'});
execSync('scp platform.tar.gz butterfly@100.70
