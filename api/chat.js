import chatHandler, { loader, action } from "../../app/routes/chat.jsx";

export default async function handler(req, res) {
  // Remix loader/action compatibility shim for Vercel
  if (req.method === "GET") {
    const response = await loader({ request: req });
    res.status(response.status || 200);
    for (const [key, value] of Object.entries(response.headers || {})) {
      res.setHeader(key, value);
    }
    if (response.body) {
      response.body.pipe(res);
    } else {
      res.end();
    }
  } else if (req.method === "POST") {
    const response = await action({ request: req });
    res.status(response.status || 200);
    for (const [key, value] of Object.entries(response.headers || {})) {
      res.setHeader(key, value);
    }
    if (response.body) {
      response.body.pipe(res);
    } else {
      res.end();
    }
  } else if (req.method === "OPTIONS") {
    res.status(204).end();
  } else {
    res.status(405).end();
  }
}
