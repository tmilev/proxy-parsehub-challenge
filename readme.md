# Proxy server for parsehub challenge


## To setup and install

1. Prerequisites. 

Install node.js. Version 9.11.2 was used for development; 
earlier/older versions should work too. 

2. Installation.

2.1 Checkout the present repository:
```
git@github.com:tmilev/proxy-parsehub-challenge.git
```

2.2. Install dependencies.

```
cd proxy-parsehub-challenge
npm install
```
3. To run, do:
```
npm run serve
```
or
```
npm run develop
```
or
```
node src/app.js
```

The server runs on port 9001.

4. To test manually, open the file 

[test_links.html](test_links.html)

4.1. GET tests.
- Stat link: A simple GET request that displays server statistics. 
- Proxy link redirecting to the stat link above.
- Proxy to google.com
- Proxy to httpbin.org/get
- Proxy to proxy to httpbin.org

4.2. POST tests
- Stat link: a simple POST request, no proxies.
- Stat link with a large post body: a simply POST request with 10MB message body.
- Proxy to the stat link.
- Proxy to the stat link with 10MB message body.
- 100x10MB proxies to the stat link.
