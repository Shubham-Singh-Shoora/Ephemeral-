import http from 'node:http';

const server = http.createServer((req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET, HEAD, POST, PUT, DELETE, OPTIONS, PATCH');
  res.setHeader('access-control-allow-headers', '*');
  res.setHeader('access-control-expose-headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const headers = { ...req.headers, host: '127.0.0.1:1633' };
    delete headers['accept-encoding'];
    if (body.length > 0) {
      headers['content-length'] = body.length;
    } else {
      delete headers['content-length'];
    }

    const proxyReq = http.request(
      {
        hostname: '127.0.0.1',
        port: 1633,
        path: req.url,
        method: req.method,
        headers,
      },
      (proxyRes) => {
        const respHeaders = { ...proxyRes.headers };
        respHeaders['access-control-allow-origin'] = '*';
        respHeaders['access-control-allow-methods'] = 'GET, HEAD, POST, PUT, DELETE, OPTIONS, PATCH';
        respHeaders['access-control-allow-headers'] = '*';
        respHeaders['access-control-expose-headers'] = '*';
        res.writeHead(proxyRes.statusCode || 200, respHeaders);
        proxyRes.pipe(res);
      }
    );

    proxyReq.on('error', (err) => {
      res.writeHead(502, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify({ error: err.message }));
    });

    if (body.length > 0) proxyReq.write(body);
    proxyReq.end();
  });
});

server.listen(1635, '127.0.0.1', () => {
  console.log('Proxy ready on 1635 -> 1633');
});
