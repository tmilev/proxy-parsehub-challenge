function ResponseWrapper (response, ownerServer) {
  this.server = ownerServer;
  this.response = response;
  this.server.requestsOpen ++;
  this.server.requestsReceived ++;
}

ResponseWrapper.prototype.writeHead = function(input, headers) {
  this.response.writeHead(input, headers);
}

ResponseWrapper.prototype.end = function(input) {
  this.server.requestsOpen --;
  this.response.end(input);
}

module.exports = {
  ResponseWrapper
};