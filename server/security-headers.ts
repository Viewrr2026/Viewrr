import helmet from "helmet";

export const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://js.stripe.com"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      mediaSrc: ["'self'", "data:", "blob:", "https:"],
      frameSrc: ["'self'", "https://js.stripe.com", "https://hooks.stripe.com", "https://www.youtube.com", "https://www.youtube-nocookie.com", "https://player.vimeo.com"],
      connectSrc: ["'self'", "https://api.stripe.com", "wss:", "ws:"],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  crossOriginEmbedderPolicy: false, // Required for Stripe embeds
});
