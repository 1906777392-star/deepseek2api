export default function handler(request, response) {
  response.statusCode = 200;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify({ revision: "openai-route-20260926-1928" }));
}
