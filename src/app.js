#!/usr/bin/env node
/**
 * Entry point
 * 
 */

"use strict";
const server = require('./server');

var currentServer = new server.Server({
  portHttp: 9001,
  maxOpenRequests: 100000
});

currentServer.run();