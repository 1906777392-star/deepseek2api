export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const upstreamUrl = new URL(url.pathname + url.search, 'https://deepseek2api-gold.vercel.app');
    
    const upstreamRequest = new Request(upstreamUrl, {
      method: request.method,
      headers: request.headers,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
      redirect: 'manual'
    });

    const response = await fetch(upstreamRequest);
    const newResponse = new Response(response.body, response);
    newResponse.headers.set('access-control-allow-origin', '*');
    
    return newResponse;
  }
};