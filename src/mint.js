#!/usr/bin/env node
'use strict';
// Re-runnable mint for this provider; gates + engine live in ../config.json.
process.argv.push('--name', require('path').basename(require('path').resolve(__dirname, '..')));
require('./provider-cli.js');
