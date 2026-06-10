import { onRequest as middlewareOnRequest } from "./worker/_middleware.js";

export default {
  async fetch(request, env, ctx) {
    return middlewareOnRequest({
      request,
      env,
      next: () => env.ASSETS.fetch(request),
      waitUntil: ctx.waitUntil.bind(ctx),
    });
  },
};
