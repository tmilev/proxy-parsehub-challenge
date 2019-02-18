const http = require('http');
const colors = require('colors');
const validURL = require('valid-url');
const url = require('url');

function ResponseWrapper (response, ownerServer) {
  this.server = ownerServer;
  this.response = response;
  this.server.requestsOpen ++;
  this.server.requestsReceived ++;
}

ResponseWrapper.prototype.writeHead = function(input, headers) {
  this.response.writeHead(input, headers);
}

ResponseWrapper.prototype.accountWrite = function(input) {
  this.server.requestsOpen --;
  if (input !== null && input !== undefined) {
    this.server.bytesToUserNoHeaders += input.length;
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
  this.bytesToUserNoHeaders = 0;
  this.bytesFromRemoteNoHeaders = 0;
  this.requestsOpen = 0;
  this.requestsReceived = 0;
  this.maxOpenRequests = configuration.maxOpenRequests;
  this.apiCalls = {
    echo: this.echo.bind(this),
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
  console.log(`DEBUG: API call: ${apiCall}, arguments: ${apiArguments}`);
  this.apiCalls[apiCall](request, response, apiArguments);
}

Server.prototype.echo = function (
  /**@type {http.IncomingMessage} */ 
  request, 
  /**@type {ResponseWrapper} */
  response,  
  /**@type {string} */
  apiArguments
) {
  response.writeHead(200, {"Access-Control-Allow-Origin": "*"});
  var summary = {};
  summary.requestsReceived = this.requestsReceived;
  summary.pendingRequests = this.requestsOpen;
  summary.headers = request.headers; 
  summary.url = request.url;
  summary.method = request.method;
  summary.apiArguments = apiArguments;
  if (request.method !== "POST") {
    response.end(JSON.stringify(summary));
    return;
  }
  summary.bytesReceived = 0;
  request.on('data', (chunk)=>{
    summary.bytesReceived += chunk.length;
  });

  request.on('end', ()=>{
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
  proxyRequest.end();
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
  console.log("Handling remote response ....");
  responseToUser.writeHead(responseRemote.statusCode, responseRemote.headers);
  responseRemote.on('data', (chunk) => {
    console.log(`Writing chunk of length ${chunk} bytes. `);
    responseToUser.write(chunk);

  });
  responseRemote.on('error', () => {
    responseToUser.end();
  });
  responseRemote.on('end', () => {
    responseToUser.end();
  });
}

module.exports = {
  Server
};