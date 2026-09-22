export async function onRequest({ request, next }) {
  const url = new URL(request.url);
  if (url.hostname === 'www.jevtool.dev') {
    url.hostname = 'jevtool.dev';
    url.protocol = 'https:';
    return Response.redirect(url.toString(), 301);
  }
  return next();
}
