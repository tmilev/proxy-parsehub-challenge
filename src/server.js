const http = require('http');
const colors = require('colors');
const validURL = require('valid-url');
const url = require('url');

function ResponseWrapper(
  /**@type {http.ServerResponse} */
  response, 
  /**@type{Server}*/ 
  ownerServer,
) {
  /**@type{Server}*/
  this.server = ownerServer;
  /**@type{http.ServerResponse}*/
  this.response = response;
  this.server.userRequestCounts.currentlyOpen ++;
  this.server.userRequestCounts.received ++;
}

ResponseWrapper.prototype.writeHead = function(input, headers) {
  this.response.writeHead(input, headers);
}

ResponseWrapper.prototype.accountWrite = function(input) {
  this.server.userRequestCounts.currentlyOpen --;
  this.server.userRequestCounts.finished ++;
  if (input !== null && input !== undefined) {
    this.server.bytesStats += input.length;
  }
}

ResponseWrapper.prototype.write = function(input) {
  this.accountWrite(input);
  this.response.end(input);
}

ResponseWrapper.prototype.end = function(input) {
  this.accountWrite(input);
  this.response.end(input);
}

function Server (configuration) {
  this.portHttp = configuration.portHttp;
  this.serverHTTP = null;
  this.bytesPOSTBody = {
    toUser: 0,
    fromUser: 0,
    toRemote: 0,
    fromRemote: 0,
  };
  this.errorCounts = {
    toRemote: 0,
    fromRemote: 0,
  };
  this.userRequestCounts = {
    currentlyOpen: 0,
    received: 0,
    finished: 0,
  };
  ///////////////////////////
  //////////////////////////
  //api call specifications:
  this.apiCalls = {
    stats: this.stats.bind(this),
    proxy: this.proxy.bind(this),
  };
  this.maxEntryPointLength = 0;
  for (var label in this.apiCalls) {
    this.maxEntryPointLength = Math.max(this.maxEntryPointLength, label.length);
  }
  this.maxEntryPointLength += 1;
}

Server.prototype.run = function () {
  this.serverHTTP = http.createServer(this.handler.bind(this));
  this.serverHTTP.listen(this.portHttp, () => {
    console.log(`Listening on http port: ${this.portHttp}`.yellow);
  });  
}

Server.prototype.handler = function (
  /**@type {http.IncomingMessage} */ 
  request, 
  /**@type {http.ServerResponse} */
  responseNonWrapped,
) {
  var response = new ResponseWrapper(responseNonWrapped, this);
  // Extract the api call. 
  // We first slice off a small portion of the url: we don't want to process the entire URL 
  // if it is very long. 
  var apiCallString = request.url.substring(0, this.maxEntryPointLength);
  // /proxy/asdf will be split to "", "proxy", "asdf"
  var apiCallsSplit = apiCallString.split("/"); 
  var apiCall = apiCallsSplit[1];
  if (!(apiCall in this.apiCalls)) {
    response.writeHead(400);
    response.end(`Unknown api call: ${apiCall}`);
    return;
  }
  // if request.url is "/proxy/someURL", then apiCall is "proxy"
  // and apiArguments will be "someURL"
  var apiArguments = request.url.substring(apiCall.length + 2);
  this.apiCalls[apiCall](request, response, apiArguments);
}

Server.prototype.stats = function (
  /**@type {http.IncomingMessage} */ 
  request, 
  /**@type {ResponseWrapper} */
  response,  
  /**@type {string} */
  apiArguments
) {
  response.writeHead(200, {"Access-Control-Allow-Origin": "*"});
  var summary = {};
  summary.bytesPOSTStats  = this.bytesPOSTStats;
  summary.errorCounts = this.errorCounts;
  summary.userRequestCounts = this.userRequestCounts;
  summary.headers = request.headers; 
  /////////////////////
  //stats about incoming message:
  summary.url = request.url;
  summary.method = request.method;
  summary.apiArguments = apiArguments;
  summary.bytesPOSTStats = this.bytesPOSTBody;
  summary.errorCounts = this.errorCounts;
  if (request.method !== "POST") {
    response.end(JSON.stringify(summary));
    return;
  }
  summary.bytesReceivedInBodyOfThisMessage = 0;
  request.on('data', (chunk) => {
    this.bytesPOSTBody.fromUser += chunk.length;
    summary.bytesReceivedInBodyOfThisMessage += chunk.length;
  });

  request.on('end', () => {
    response.end(JSON.stringify(summary));
  });
}

Server.prototype.proxy = function (
  /**@type {http.IncomingMessage} */ 
  request, 
  /**@type {ResponseWrapper} */
  response,  
  /**@type {string} */
  apiArguments
) {
  if (request.method !== "POST" && request.method !== "GET") {
    response.writeHead(500);
    response.end(`Method ${request.method} not supported. `);
    return;
  }
  // Not using CONNECT request or similar, as the parseHub challenge requests to use post and get. 
  // This may actually be a good idea as not all servers support the CONNECT method. 
  var valid = validURL.isHttpUri(apiArguments);
  if (valid === null || valid === false || valid === undefined) {
    response.writeHead(200);
    response.end(`${apiArguments} does not appear to be a valid http URL (https not supported). Did you forget http:// ?`);
    return;
  }
  // shallow-copy the request headers. Shallow copy is sufficient, as headers are one-level nested:
  var proxyHeaders = Object.assign({}, request.headers);
  /** @type {URL} */
  var incomingURL = url.parse(apiArguments);
  if (proxyHeaders.host !== undefined && proxyHeaders.host !== null) {
    // This is not specified by the parseHub challenge, 
    // but if the host field is present in the proxy request - in that case, that field 
    // likely points to the proxy's hostname - 
    // it then makes sense to overwrite the host field with the target url. 
    proxyHeaders.host = incomingURL.host;
  }
  var proxyRequest = http.request({
      hostname: incomingURL.hostname,
      port: incomingURL.port,
      path: incomingURL.pathname,
      method: request.method,
      headers: proxyHeaders 
    }, 
    this.handleRemoteReponse.bind(this, response),
  );
  proxyRequest.on('error', this.handleRemoteError.bind(this, response));
  if (request.method === "GET") {
    proxyRequest.end();
    return;
  }
  /////////////////////////////
  if (request.method === "POST") {
    request.on('data', (chunk) => {
      this.bytesPOSTBody.fromUser += chunk.length;
      this.bytesPOSTBody.toRemote += chunk.length;
      proxyRequest.write(chunk);
    });
    request.on('error', (err) => {
      console.log(`User request error: ` + `${err}`.red);
      this.errorCounts.fromUser += chunk.length;
      proxyRequest.end();
    });
    request.on('end', () => {
      proxyRequest.end();
    });
    return;
  }
  throw(`Programming error: request.method must be POST or GET at this stage, it is: ${request.method} instead. `);
}

Server.prototype.handleRemoteError = function(  
  /**@type {ResponseWrapper} */
  responseToUser, 
  error,
) {
  // Remote connection failed: this can be a user-side error, say, bad url - status 400;
  // a server side error, say, bad server internet connection - status 500, 
  // or a remote server error, say, remote server is down - this should actually be status 200.
  responseToUser.writeHead(200); 
  responseToUser.end(error);
}

Server.prototype.handleRemoteReponse = function(
  /**@type {ResponseWrapper} */
  responseToUser, 
  /**@type {http.ServerResponse} */
  responseRemote,
) {
  responseToUser.writeHead(responseRemote.statusCode, responseRemote.headers);
  responseRemote.on('data', (chunk) => {
    this.bytesPOSTBody.fromRemote += chunk.length;
    this.bytesPOSTBody.toUser += chunk.length;
    responseToUser.write(chunk);
  });
  responseRemote.on('error', () => {
    this.errorCounts.fromRemote ++;
    responseToUser.end();
  });
  responseRemote.on('end', () => {
    responseToUser.end();
  });
}

module.exports = {
  Server
};