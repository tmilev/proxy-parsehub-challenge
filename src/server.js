const http = require('http');
const colors = require('colors');
const ResponseWrapper = require('./response_wrapper.js').ResponseWrapper;

function Server (configuration) {
  this.portHttp = configuration.portHttp;
  this.serverHTTP = null;
  this.bytesTransmitted = 0;
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
  // if request.url is "/proxy/asdf", then apiCall is "proxy"
  // and apiArguments will be "asdf"
  var apiArguments = request.url.substring(apiCall.length + 2);
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
  response.writeHead(200);
  var summary = {};
  summary.requestsReceived = this.requestsReceived;
  summary.pendingRequests = this.requestsOpen;
  summary.headers = request.headers; 
  summary.url = request.url;
  summary.apiArguments = apiArguments;
  response.end(JSON.stringify(summary));
}

Server.prototype.proxy = function (
  /**@type {http.IncomingMessage} */ 
  request, 
  /**@type {ResponseWrapper} */
  response,  
  /**@type {string} */
  apiArguments
) {
  response.writeHead(200);
  response.end("Not implemented yet.");  
}

module.exports = {
  Server
};